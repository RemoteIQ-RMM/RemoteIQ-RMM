// agents/windows/RemoteIQ.Agent/Services/RemoteDesktopTunnelWorker.cs

using System;
using System.Buffers;
using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class RemoteDesktopTunnelWorker : BackgroundService
{
    private readonly ConfigService _cfg;
    private readonly ILogger<RemoteDesktopTunnelWorker> _log;

    private readonly JsonSerializerOptions _json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly ConcurrentDictionary<string, TunnelSession> _sessions = new();
    private CancellationTokenSource? _linkedCts;

    public RemoteDesktopTunnelWorker(ConfigService cfg, ILogger<RemoteDesktopTunnelWorker> log)
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

            var wsUri = BuildDesktopTunnelWsUri(_cfg.Current.ApiBaseUrl, agentUuid);
            if (wsUri is null)
            {
                _log.LogError("Invalid ApiBaseUrl for desktop tunnel WS: {ApiBaseUrl}", _cfg.Current.ApiBaseUrl);
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                continue;
            }

            using var ws = new ClientWebSocket();
            ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

            _linkedCts?.Dispose();
            _linkedCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);

            try
            {
                await ws.ConnectAsync(wsUri, _linkedCts.Token);
                _log.LogInformation("RemoteDesktopTunnel WS connected: {Uri}", wsUri);

                // ✅ Authenticate with the field names the backend expects:
                // HelloMessage = { type:"hello", agentUuid:string, agentToken:string }
                await SendAsync(ws, new
                {
                    type = "hello",
                    agentUuid,
                    agentToken = _cfg.Current.AgentKey
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
                _log.LogWarning(wse, "RemoteDesktopTunnel WS error; reconnecting in 5s");
                await CleanupSessions();
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "RemoteDesktopTunnel WS error; reconnecting in 5s");
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
                WebSocketReceiveResult? res;
                using var ms = new System.IO.MemoryStream();

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
                        ms.Write(buffer, 0, res.Count);
                }
                while (!res.EndOfMessage);

                if (ms.Length == 0) continue;

                if (res.MessageType == WebSocketMessageType.Text)
                {
                    var text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
                    if (!string.IsNullOrWhiteSpace(text))
                        await HandleTextMessage(ws, text, ct);
                }
                else if (res.MessageType == WebSocketMessageType.Binary)
                {
                    var data = ms.ToArray();
                    HandleBinaryMessage(data);
                }
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private async Task HandleTextMessage(ClientWebSocket ws, string text, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;

            if (!root.TryGetProperty("type", out var typeEl)) return;
            var type = typeEl.GetString() ?? "";

            switch (type)
            {
                case "ping":
                    {
                        var ts = root.TryGetProperty("ts", out var tsEl) && tsEl.ValueKind == JsonValueKind.Number
                            ? tsEl.GetInt64()
                            : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                        await SendAsync(ws, new { type = "pong", ts }, ct);
                        return;
                    }

                case "rdp.open":
                    {
                        var sessionId = ReadString(root, "sessionId") ?? "";
                        if (string.IsNullOrWhiteSpace(sessionId)) return;

                        var host = (ReadString(root, "host") ?? "127.0.0.1").Trim();
                        var port = ReadInt(root, "port") ?? 3389;

                        _ = Task.Run(() => OpenSession(ws, sessionId, host, port, ct), ct);
                        return;
                    }

                case "rdp.close":
                    {
                        var sessionId = ReadString(root, "sessionId") ?? "";
                        if (string.IsNullOrWhiteSpace(sessionId)) return;

                        CloseSession(sessionId, "backend_close");
                        return;
                    }

                default:
                    _log.LogDebug("RemoteDesktopTunnel WS unknown message type: {Type}", type);
                    return;
            }
        }
        catch (JsonException)
        {
            // ignore parse errors
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "RemoteDesktopTunnel WS message handling error");
        }
    }

    private void HandleBinaryMessage(byte[] data)
    {
        try
        {
            var frame = DecodeDataFrame(data);
            if (!_sessions.TryGetValue(frame.SessionId, out var session))
                return;

            session.WriteToTcp(frame.Payload);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "RemoteDesktopTunnel failed to handle binary frame");
        }
    }

    private async Task OpenSession(ClientWebSocket ws, string sessionId, string host, int port, CancellationToken ct)
    {
        if (_sessions.TryRemove(sessionId, out var existing))
        {
            try { existing.Dispose(); } catch { }
        }

        var session = new TunnelSession(sessionId, _log);

        try
        {
            await session.ConnectTcp(host, port, ct);

            if (!_sessions.TryAdd(sessionId, session))
            {
                session.Dispose();
                return;
            }

            await SendAsync(ws, new { type = "rdp.ready", sessionId }, ct);

            // Start TCP -> WS relay
            _ = Task.Run(async () =>
            {
                try
                {
                    await foreach (var chunk in session.ReadTcpChunks(ct))
                    {
                        var framed = EncodeDataFrame(sessionId, chunk);
                        await SendBinaryAsync(ws, framed, ct);
                    }

                    await SendAsync(ws, new { type = "rdp.closed", sessionId, reason = "tcp_eof" }, ct);
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "RemoteDesktopTunnel relay failed session {SessionId}", sessionId);
                    try { await SendAsync(ws, new { type = "rdp.closed", sessionId, reason = "relay_error" }, ct); } catch { }
                }
                finally
                {
                    CloseSession(sessionId, "relay_end");
                }
            }, ct);
        }
        catch (SocketException sex)
        {
            var msg = $"TCP connect failed to {host}:{port} ({sex.SocketErrorCode})";
            _log.LogWarning(sex, msg);
            await SendAsync(ws, new { type = "rdp.error", sessionId, code = "TCP_CONNECT_FAILED", message = msg }, ct);
            session.Dispose();
        }
        catch (Exception ex)
        {
            var msg = $"Session open failed: {ex.Message}";
            _log.LogWarning(ex, msg);
            await SendAsync(ws, new { type = "rdp.error", sessionId, code = "OPEN_FAILED", message = msg }, ct);
            session.Dispose();
        }
    }

    private void CloseSession(string sessionId, string reason)
    {
        if (_sessions.TryRemove(sessionId, out var s))
        {
            try { s.Dispose(); } catch { }
            _log.LogInformation("RemoteDesktopTunnel session closed {SessionId} ({Reason})", sessionId, reason);
        }
    }

    private async Task SendAsync(ClientWebSocket ws, object payload, CancellationToken ct)
    {
        if (ws.State != WebSocketState.Open) return;

        var json = JsonSerializer.Serialize(payload, _json);
        var bytes = Encoding.UTF8.GetBytes(json);

        await ws.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken: ct);
    }

    private static async Task SendBinaryAsync(ClientWebSocket ws, byte[] data, CancellationToken ct)
    {
        if (ws.State != WebSocketState.Open) return;
        await ws.SendAsync(new ArraySegment<byte>(data), WebSocketMessageType.Binary, endOfMessage: true, cancellationToken: ct);
    }

    private async Task CleanupSessions()
    {
        foreach (var kv in _sessions)
        {
            try { kv.Value.Dispose(); } catch { }
        }
        _sessions.Clear();
        await Task.CompletedTask;
    }

    private static Uri? BuildDesktopTunnelWsUri(string apiBaseUrl, string agentUuid)
    {
        if (string.IsNullOrWhiteSpace(apiBaseUrl)) return null;
        if (!Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var u)) return null;

        var scheme = u.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";

        var builder = new UriBuilder(u)
        {
            Scheme = scheme,
            Path = "/ws/desktop-tunnel",
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

    // ---------------- Framing (matches backend) ----------------
    private readonly record struct DataFrame(string SessionId, byte[] Payload);

    // frameType(0x01) + uint16be sidLen + sidUtf8 + payload
    private static byte[] EncodeDataFrame(string sessionId, byte[] payload)
    {
        var sidBytes = Encoding.UTF8.GetBytes(sessionId);
        if (sidBytes.Length > ushort.MaxValue) throw new InvalidOperationException("sessionId too long");

        var outBuf = new byte[1 + 2 + sidBytes.Length + payload.Length];
        outBuf[0] = 0x01;
        BinaryPrimitives.WriteUInt16BigEndian(outBuf.AsSpan(1, 2), (ushort)sidBytes.Length);
        Buffer.BlockCopy(sidBytes, 0, outBuf, 3, sidBytes.Length);
        Buffer.BlockCopy(payload, 0, outBuf, 3 + sidBytes.Length, payload.Length);
        return outBuf;
    }

    private static DataFrame DecodeDataFrame(byte[] data)
    {
        if (data.Length < 3) throw new InvalidOperationException("frame too short");
        var frameType = data[0];
        if (frameType != 0x01) throw new InvalidOperationException("unknown frameType");

        var sidLen = BinaryPrimitives.ReadUInt16BigEndian(data.AsSpan(1, 2));
        if (data.Length < 3 + sidLen) throw new InvalidOperationException("invalid sessionIdLen");

        var sid = Encoding.UTF8.GetString(data, 3, sidLen);
        var payloadLen = data.Length - (3 + sidLen);
        var payload = new byte[payloadLen];
        Buffer.BlockCopy(data, 3 + sidLen, payload, 0, payloadLen);

        return new DataFrame(sid, payload);
    }

    private sealed class TunnelSession : IDisposable
    {
        private readonly string _sessionId;
        private readonly ILogger _logger;

        private TcpClient? _tcp;
        private NetworkStream? _stream;

        public TunnelSession(string sessionId, ILogger logger)
        {
            _sessionId = sessionId;
            _logger = logger;
        }

        public async Task ConnectTcp(string host, int port, CancellationToken ct)
        {
            _tcp = new TcpClient();
            await _tcp.ConnectAsync(host, port, ct);
            _stream = _tcp.GetStream();
        }

        public void WriteToTcp(byte[] payload)
        {
            var s = _stream;
            if (s == null) return;

            try
            {
                s.Write(payload, 0, payload.Length);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "RemoteDesktopTunnel WriteToTcp failed session {SessionId}", _sessionId);
                Dispose();
            }
        }

        public async IAsyncEnumerable<byte[]> ReadTcpChunks([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
        {
            var s = _stream;
            if (s == null) yield break;

            var buf = new byte[32 * 1024];

            while (!ct.IsCancellationRequested)
            {
                int read;
                try
                {
                    read = await s.ReadAsync(buf, 0, buf.Length, ct);
                }
                catch (OperationCanceledException) { yield break; }
                catch { yield break; }

                if (read <= 0) yield break;

                var chunk = new byte[read];
                Buffer.BlockCopy(buf, 0, chunk, 0, read);
                yield return chunk;
            }
        }

        public void Dispose()
        {
            try { _stream?.Close(); } catch { }
            try { _tcp?.Close(); } catch { }
            _stream = null;
            _tcp = null;
        }
    }
}
