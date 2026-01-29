using System;
using System.Buffers;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace RemoteIq.Agent.RemoteShell
{
    public sealed class RemoteShellAgent : IAsyncDisposable
    {
        private readonly Uri _wsUri;
        private readonly string _agentUuid;
        private readonly ClientWebSocket _ws = new ClientWebSocket();
        private readonly JsonSerializerOptions _json = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        private readonly ConcurrentDictionary<string, IShellSession> _sessions = new();

        private CancellationTokenSource? _cts;
        private Task? _loopTask;

        public RemoteShellAgent(string wsBase, string agentUuid)
        {
            if (string.IsNullOrWhiteSpace(wsBase)) throw new ArgumentException("wsBase required");
            if (string.IsNullOrWhiteSpace(agentUuid)) throw new ArgumentException("agentUuid required");

            _agentUuid = agentUuid.Trim();

            // wsBase example: ws://localhost:3001/ws
            var baseUri = wsBase.TrimEnd('/');
            var full = $"{baseUri}/shell?role=agent&agentUuid={Uri.EscapeDataString(_agentUuid)}";
            _wsUri = new Uri(full);
        }

        public async Task StartAsync(CancellationToken externalCt)
        {
            if (_cts != null) throw new InvalidOperationException("Already started.");

            _cts = CancellationTokenSource.CreateLinkedTokenSource(externalCt);

            await _ws.ConnectAsync(_wsUri, _cts.Token).ConfigureAwait(false);

            // optional hello (not required by gateway)
            await SendAsync(new { type = "hello", agentUuid = _agentUuid }, _cts.Token).ConfigureAwait(false);

            _loopTask = Task.Run(() => ReceiveLoop(_cts.Token));
        }

        public async Task StopAsync()
        {
            if (_cts == null) return;

            try { _cts.Cancel(); } catch { }

            try
            {
                foreach (var kv in _sessions)
                {
                    try { await kv.Value.DisposeAsync().ConfigureAwait(false); } catch { }
                }
                _sessions.Clear();
            }
            catch { }

            try
            {
                if (_ws.State == WebSocketState.Open || _ws.State == WebSocketState.CloseReceived)
                    await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Agent stopping", CancellationToken.None)
                        .ConfigureAwait(false);
            }
            catch { }

            try { _ws.Dispose(); } catch { }
        }

        public async ValueTask DisposeAsync()
        {
            await StopAsync().ConfigureAwait(false);
        }

        private async Task ReceiveLoop(CancellationToken ct)
        {
            var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);

            try
            {
                while (!ct.IsCancellationRequested && _ws.State == WebSocketState.Open)
                {
                    var sb = new StringBuilder();
                    WebSocketReceiveResult? result;

                    do
                    {
                        result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close) return;

                        var chunk = Encoding.UTF8.GetString(buffer, 0, result.Count);
                        sb.Append(chunk);

                    } while (!result.EndOfMessage);

                    var text = sb.ToString();
                    if (string.IsNullOrWhiteSpace(text)) continue;

                    JsonDocument? doc = null;
                    try { doc = JsonDocument.Parse(text); }
                    catch { continue; }

                    if (!doc.RootElement.TryGetProperty("type", out var typeEl)) continue;
                    var type = typeEl.GetString() ?? "";

                    // Server -> agent message types
                    switch (type)
                    {
                        case "shell.open":
                            await HandleOpen(doc.RootElement, ct).ConfigureAwait(false);
                            break;

                        case "shell.input":
                            await HandleInput(doc.RootElement, ct).ConfigureAwait(false);
                            break;

                        case "shell.signal":
                            await HandleSignal(doc.RootElement, ct).ConfigureAwait(false);
                            break;

                        case "shell.resize":
                            await HandleResize(doc.RootElement, ct).ConfigureAwait(false);
                            break;

                        case "shell.close":
                            await HandleClose(doc.RootElement, ct).ConfigureAwait(false);
                            break;

                        default:
                            break;
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (WebSocketException) { }
            catch (Exception ex)
            {
                await TrySendError(null, $"Receive loop error: {ex.Message}", CancellationToken.None).ConfigureAwait(false);
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(buffer);
            }
        }

        private async Task HandleOpen(JsonElement root, CancellationToken ct)
        {
            var sessionId = root.GetProperty("sessionId").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(sessionId)) return;

            int? cols = null;
            int? rows = null;
            if (root.TryGetProperty("cols", out var c) && c.ValueKind == JsonValueKind.Number) cols = c.GetInt32();
            if (root.TryGetProperty("rows", out var r) && r.ValueKind == JsonValueKind.Number) rows = r.GetInt32();

            IShellSession session;
            try
            {
                session = ConPtyShellSession.IsSupported()
                    ? new ConPtyShellSession(sessionId, SendDataAsync, SendExitAsync)
                    : new BasicShellSession(sessionId, SendDataAsync, SendExitAsync);
            }
            catch (Exception ex)
            {
                await TrySendError(sessionId, $"Failed to create shell session: {ex.Message}", ct).ConfigureAwait(false);
                return;
            }

            if (!_sessions.TryAdd(sessionId, session))
            {
                await session.DisposeAsync().ConfigureAwait(false);
                return;
            }

            try
            {
                await session.StartAsync(cols ?? 120, rows ?? 30, ct).ConfigureAwait(false);
                await SendAsync(new { type = "shell.ready", sessionId }, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _sessions.TryRemove(sessionId, out _);
                await session.DisposeAsync().ConfigureAwait(false);
                await TrySendError(sessionId, $"Shell start failed: {ex.Message}", ct).ConfigureAwait(false);
            }
        }

        private async Task HandleInput(JsonElement root, CancellationToken ct)
        {
            var sessionId = root.GetProperty("sessionId").GetString() ?? "";
            var data = root.GetProperty("data").GetString() ?? "";

            if (string.IsNullOrWhiteSpace(sessionId)) return;
            if (_sessions.TryGetValue(sessionId, out var sess))
            {
                await sess.WriteAsync(data, ct).ConfigureAwait(false);
            }
        }

        private async Task HandleSignal(JsonElement root, CancellationToken ct)
        {
            var sessionId = root.GetProperty("sessionId").GetString() ?? "";
            var signal = root.GetProperty("signal").GetString() ?? "SIGINT";

            if (string.IsNullOrWhiteSpace(sessionId)) return;
            if (_sessions.TryGetValue(sessionId, out var sess))
            {
                await sess.SignalAsync(signal, ct).ConfigureAwait(false);
            }
        }

        private async Task HandleResize(JsonElement root, CancellationToken ct)
        {
            var sessionId = root.GetProperty("sessionId").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(sessionId)) return;

            int cols = root.TryGetProperty("cols", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetInt32() : 120;
            int rows = root.TryGetProperty("rows", out var r) && r.ValueKind == JsonValueKind.Number ? r.GetInt32() : 30;

            if (_sessions.TryGetValue(sessionId, out var sess))
            {
                await sess.ResizeAsync(cols, rows, ct).ConfigureAwait(false);
            }
        }

        private async Task HandleClose(JsonElement root, CancellationToken ct)
        {
            var sessionId = root.GetProperty("sessionId").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(sessionId)) return;

            if (_sessions.TryRemove(sessionId, out var sess))
            {
                try { await sess.DisposeAsync().ConfigureAwait(false); } catch { }
                await SendAsync(new { type = "shell.exit", sessionId, message = "Closed by server" }, ct).ConfigureAwait(false);
            }
        }

        private Task SendDataAsync(string sessionId, string chunk, CancellationToken ct)
            => SendAsync(new { type = "shell.data", sessionId, data = chunk }, ct);

        private Task SendExitAsync(string sessionId, int? code, string? signal, string? message, CancellationToken ct)
            => SendAsync(new { type = "shell.exit", sessionId, code, signal, message }, ct);

        private Task TrySendError(string? sessionId, string message, CancellationToken ct)
            => SendAsync(new { type = "shell.error", sessionId, message }, ct);

        private async Task SendAsync(object obj, CancellationToken ct)
        {
            if (_ws.State != WebSocketState.Open) return;

            var json = JsonSerializer.Serialize(obj, _json);
            var bytes = Encoding.UTF8.GetBytes(json);

            await _ws.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken: ct)
                .ConfigureAwait(false);
        }
    }

    public interface IShellSession : IAsyncDisposable
    {
        Task StartAsync(int cols, int rows, CancellationToken ct);
        Task WriteAsync(string data, CancellationToken ct);
        Task SignalAsync(string signal, CancellationToken ct);
        Task ResizeAsync(int cols, int rows, CancellationToken ct);
    }
}
