// agents/windows/RemoteIQ.Agent/Services/RemoteShellWorker.cs

using System;
using System.Buffers;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RemoteIq.Agent.RemoteShell; // ConPtyShellSession, BasicShellSession, IShellSession

namespace RemoteIQ.Agent.Services;

public sealed class RemoteShellWorker : BackgroundService
{
    private readonly ConfigService _cfg;
    private readonly ILogger<RemoteShellWorker> _log;

    private readonly JsonSerializerOptions _json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly ConcurrentDictionary<string, IShellSession> _sessions = new();
    private CancellationTokenSource? _linkedCts;

    public RemoteShellWorker(ConfigService cfg, ILogger<RemoteShellWorker> log)
    {
        _cfg = cfg;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (string.IsNullOrWhiteSpace(_cfg.Current.AgentId) || string.IsNullOrWhiteSpace(_cfg.Current.AgentKey))
            {
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
                continue;
            }

            var agentUuid = _cfg.Current.AgentId.Trim();

            var wsUri = BuildShellWsUri(_cfg.Current.ApiBaseUrl, agentUuid);
            if (wsUri is null)
            {
                _log.LogError("Invalid ApiBaseUrl for remote shell WS: {ApiBaseUrl}", _cfg.Current.ApiBaseUrl);
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                continue;
            }

            using var ws = new ClientWebSocket();

            _linkedCts?.Dispose();
            _linkedCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);

            try
            {
                await ws.ConnectAsync(wsUri, _linkedCts.Token);
                _log.LogInformation("RemoteShell WS connected: {Uri}", wsUri);

                await SendAsync(ws, new
                {
                    type = "hello",
                    agentUuid,
                    token = _cfg.Current.AgentKey
                }, _linkedCts.Token);

                await ReceiveLoop(ws, _linkedCts.Token);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                await CleanupSessions();
                return;
            }
            catch (WebSocketException wse)
            {
                _log.LogWarning(wse, "RemoteShell WS error; reconnecting in 5s");
                await CleanupSessions();
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "RemoteShell WS error; reconnecting in 5s");
                await CleanupSessions();
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task ReceiveLoop(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);

        try
        {
            while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
            {
                var sb = new StringBuilder();
                WebSocketReceiveResult? res;

                do
                {
                    res = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                    if (res.MessageType == WebSocketMessageType.Close)
                    {
                        try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "closing", CancellationToken.None); }
                        catch { /* ignore */ }
                        return;
                    }

                    if (res.Count > 0)
                        sb.Append(Encoding.UTF8.GetString(buffer, 0, res.Count));
                }
                while (!res.EndOfMessage);

                var text = sb.ToString();
                if (string.IsNullOrWhiteSpace(text)) continue;

                try
                {
                    using var doc = JsonDocument.Parse(text);
                    var root = doc.RootElement;

                    if (!root.TryGetProperty("type", out var typeEl)) continue;
                    var type = typeEl.GetString() ?? "";

                    switch (type)
                    {
                        case "shell.open":
                            await HandleOpen(ws, root, ct);
                            break;
                        case "shell.input":
                            await HandleInput(root, ct);
                            break;
                        case "shell.signal":
                            await HandleSignal(root, ct);
                            break;
                        case "shell.resize":
                            await HandleResize(root, ct);
                            break;
                        case "shell.close":
                            await HandleClose(ws, root, ct);
                            break;
                        default:
                            _log.LogDebug("RemoteShell WS unknown message type: {Type}", type);
                            break;
                    }
                }
                catch (JsonException)
                {
                    // ignore parse errors
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "RemoteShell WS message handling error");
                }
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private async Task HandleOpen(ClientWebSocket ws, JsonElement root, CancellationToken ct)
    {
        var sessionId = ReadString(root, "sessionId") ?? "";
        if (string.IsNullOrWhiteSpace(sessionId)) return;

        int cols = ReadInt(root, "cols") ?? 120;
        int rows = ReadInt(root, "rows") ?? 30;

        var runAsRaw = (ReadString(root, "runAs") ?? "system").Trim().ToLowerInvariant();
        var runAs = runAsRaw == "user" ? ShellRunAs.LoggedInUser : ShellRunAs.System;

        if (_sessions.TryRemove(sessionId, out var existing))
        {
            try { await existing.DisposeAsync(); } catch { }
        }

        IShellSession session;
        try
        {
            if (runAs == ShellRunAs.LoggedInUser && !ConPtyShellSession.IsSupported())
                throw new InvalidOperationException("Run-as-user requires ConPTY (Windows 10 1809+).");

            session = ConPtyShellSession.IsSupported()
                ? new ConPtyShellSession(sessionId, SendDataAsync(ws), SendExitAsync(ws), runAs)
                : new BasicShellSession(sessionId, SendDataAsync(ws), SendExitAsync(ws)); // system only
        }
        catch (Exception ex)
        {
            await TrySendError(ws, sessionId, $"Failed to create shell session: {ex.Message}", ct);
            return;
        }

        if (!_sessions.TryAdd(sessionId, session))
        {
            try { await session.DisposeAsync(); } catch { }
            return;
        }

        try
        {
            await session.StartAsync(cols, rows, ct);
            await SendAsync(ws, new { type = "shell.ready", sessionId }, ct);
        }
        catch (Exception ex)
        {
            _sessions.TryRemove(sessionId, out _);
            try { await session.DisposeAsync(); } catch { }
            await TrySendError(ws, sessionId, $"Shell start failed: {ex.Message}", ct);
        }
    }

    private async Task HandleInput(JsonElement root, CancellationToken ct)
    {
        var sessionId = ReadString(root, "sessionId") ?? "";
        var data = ReadString(root, "data") ?? "";

        if (string.IsNullOrWhiteSpace(sessionId)) return;

        if (_sessions.TryGetValue(sessionId, out var sess))
            await sess.WriteAsync(data, ct);
    }

    private async Task HandleSignal(JsonElement root, CancellationToken ct)
    {
        var sessionId = ReadString(root, "sessionId") ?? "";
        var signal = ReadString(root, "signal") ?? "SIGINT";

        if (string.IsNullOrWhiteSpace(sessionId)) return;

        if (_sessions.TryGetValue(sessionId, out var sess))
            await sess.SignalAsync(signal, ct);
    }

    private async Task HandleResize(JsonElement root, CancellationToken ct)
    {
        var sessionId = ReadString(root, "sessionId") ?? "";
        if (string.IsNullOrWhiteSpace(sessionId)) return;

        var cols = ReadInt(root, "cols") ?? 120;
        var rows = ReadInt(root, "rows") ?? 30;

        if (_sessions.TryGetValue(sessionId, out var sess))
            await sess.ResizeAsync(cols, rows, ct);
    }

    private async Task HandleClose(ClientWebSocket ws, JsonElement root, CancellationToken ct)
    {
        var sessionId = ReadString(root, "sessionId") ?? "";
        if (string.IsNullOrWhiteSpace(sessionId)) return;

        if (_sessions.TryRemove(sessionId, out var sess))
        {
            try { await sess.DisposeAsync(); } catch { }
            await SendAsync(ws, new { type = "shell.exit", sessionId, message = "Closed by server" }, ct);
        }
    }

    private Func<string, string, CancellationToken, Task> SendDataAsync(ClientWebSocket ws)
        => (sessionId, chunk, ct) => SendAsync(ws, new { type = "shell.data", sessionId, data = chunk }, ct);

    private Func<string, int?, string?, string?, CancellationToken, Task> SendExitAsync(ClientWebSocket ws)
        => (sessionId, code, signal, message, ct) => SendAsync(ws, new { type = "shell.exit", sessionId, code, signal, message }, ct);

    private Task TrySendError(ClientWebSocket ws, string? sessionId, string message, CancellationToken ct)
        => SendAsync(ws, new { type = "shell.error", sessionId, message }, ct);

    private async Task SendAsync(ClientWebSocket ws, object payload, CancellationToken ct)
    {
        if (ws.State != WebSocketState.Open) return;

        var json = JsonSerializer.Serialize(payload, _json);
        var bytes = Encoding.UTF8.GetBytes(json);

        await ws.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken: ct);
    }

    private async Task CleanupSessions()
    {
        foreach (var kv in _sessions)
        {
            try { await kv.Value.DisposeAsync(); } catch { }
        }
        _sessions.Clear();
    }

    private static Uri? BuildShellWsUri(string apiBaseUrl, string agentUuid)
    {
        if (string.IsNullOrWhiteSpace(apiBaseUrl)) return null;
        if (!Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var u)) return null;

        var scheme = u.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";

        var builder = new UriBuilder(u)
        {
            Scheme = scheme,
            Path = "/ws/shell",
            Query = $"role=agent&agentUuid={Uri.EscapeDataString(agentUuid)}"
        };

        return builder.Uri;
    }

    private static string? ReadString(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var el)) return null;
        return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
    }

    private static int? ReadInt(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var el)) return null;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var i)) return i;
        if (el.ValueKind == JsonValueKind.String && int.TryParse(el.GetString(), out var si)) return si;
        return null;
    }
}
