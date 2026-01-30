// RemoteIQ.Agent/Services/RemoteDesktopTunnelWorker.cs

using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class RemoteDesktopTunnelWorker : BackgroundService
{
    private readonly ILogger<RemoteDesktopTunnelWorker> _logger;

    // TODO: replace these with your existing config/AgentIdentity provider
    private readonly string _wsBase;
    private readonly string _agentUuid;
    private readonly string _agentKey;

    private ClientWebSocket? _ws;

    private readonly ConcurrentDictionary<string, TunnelSession> _sessions = new();

    public RemoteDesktopTunnelWorker(ILogger<RemoteDesktopTunnelWorker> logger)
    {
        _logger = logger;

        // Minimal env-based config so this file compiles standalone.
        // Wire into your existing agent config system when integrating.
        _wsBase = Environment.GetEnvironmentVariable("REMOTEIQ_WS_BASE") ?? "ws://localhost:3001";
        _agentUuid = Environment.GetEnvironmentVariable("REMOTEIQ_AGENT_UUID") ?? "";
        _agentKey = Environment.GetEnvironmentVariable("REMOTEIQ_AGENT_KEY") ?? "";
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_agentUuid) || string.IsNullOrWhiteSpace(_agentKey))
        {
            _logger.LogError("RemoteDesktopTunnelWorker missing REMOTEIQ_AGENT_UUID / REMOTEIQ_AGENT_KEY");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                _ws = new ClientWebSocket();
                _ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

                var uri = BuildUri();
                _logger.LogInformation("Desktop tunnel connecting to {Uri}", uri);

                await _ws.ConnectAsync(uri, stoppingToken);
                _logger.LogInformation("Desktop tunnel connected");

                // Receive loop
                await ReceiveLoop(_ws, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // shutdown
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Desktop tunnel connection loop error");
            }

            // Cleanup all active sessions on disconnect
            foreach (var kvp in _sessions)
            {
                try { kvp.Value.Dispose(); } catch { }
            }
            _sessions.Clear();

            // backoff
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    private Uri BuildUri()
    {
        // Ensure /ws/desktop-tunnel
        var baseUri = _wsBase.TrimEnd('/');
        var url = $"{baseUri}/ws/desktop-tunnel?role=agent&agentUuid={Uri.EscapeDataString(_agentUuid)}&agentKey={Uri.EscapeDataString(_agentKey)}";
        return new Uri(url);
    }

    private async Task ReceiveLoop(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[1024 * 64];

        while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            WebSocketReceiveResult? result = null;
            using var ms = new MemoryStream();

            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                if (result.MessageType == WebSocketMessageType.Close)
                    return;

                ms.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            var data = ms.ToArray();

            if (result.MessageType == WebSocketMessageType.Text)
            {
                var text = Encoding.UTF8.GetString(data);
                await HandleTextMessage(ws, text, ct);
            }
            else if (result.MessageType == WebSocketMessageType.Binary)
            {
                HandleBinaryMessage(data);
            }
        }
    }

    private async Task HandleTextMessage(ClientWebSocket ws, string text, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;

            if (!root.TryGetProperty("type", out var typeEl))
                return;

            var type = typeEl.GetString() ?? "";

            if (type == "ping")
            {
                var ts = root.TryGetProperty("ts", out var tsEl) ? tsEl.GetInt64() : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                var pong = JsonSerializer.Serialize(new { type = "pong", ts });
                await SendText(ws, pong, ct);
                return;
            }

            if (type == "rdp.open")
            {
                var sessionId = root.GetProperty("sessionId").GetString() ?? "";
                var host = root.GetProperty("host").GetString() ?? "127.0.0.1";
                var port = root.GetProperty("port").GetInt32();

                _ = Task.Run(() => OpenSession(ws, sessionId, host, port, ct), ct);
                return;
            }

            if (type == "rdp.close")
            {
                var sessionId = root.GetProperty("sessionId").GetString() ?? "";
                CloseSession(sessionId, reason: "backend_close");
                return;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to parse desktop tunnel control message");
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
            _logger.LogWarning(ex, "Failed to handle binary frame");
        }
    }

    private async Task OpenSession(ClientWebSocket ws, string sessionId, string host, int port, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
            return;

        if (_sessions.ContainsKey(sessionId))
        {
            // already exists; close & replace
            CloseSession(sessionId, "replace");
        }

        var session = new TunnelSession(sessionId, _logger);

        try
        {
            await session.ConnectTcp(host, port, ct);

            _sessions[sessionId] = session;

            // ready
            await SendText(ws, JsonSerializer.Serialize(new { type = "rdp.ready", sessionId }), ct);

            // start TCP->WS relay
            _ = Task.Run(async () =>
            {
                try
                {
                    await foreach (var chunk in session.ReadTcpChunks(ct))
                    {
                        var framed = EncodeDataFrame(sessionId, chunk);
                        await SendBinary(ws, framed, ct);
                    }

                    await SendText(ws, JsonSerializer.Serialize(new { type = "rdp.closed", sessionId, reason = "tcp_eof" }), ct);
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "TCP->WS relay failed for session {SessionId}", sessionId);
                    try
                    {
                        await SendText(ws, JsonSerializer.Serialize(new { type = "rdp.closed", sessionId, reason = "relay_error" }), ct);
                    }
                    catch { }
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
            _logger.LogWarning(sex, msg);
            await SendText(ws, JsonSerializer.Serialize(new { type = "rdp.error", sessionId, code = "TCP_CONNECT_FAILED", message = msg }), ct);
            session.Dispose();
        }
        catch (Exception ex)
        {
            var msg = $"Session open failed: {ex.Message}";
            _logger.LogWarning(ex, msg);
            await SendText(ws, JsonSerializer.Serialize(new { type = "rdp.error", sessionId, code = "OPEN_FAILED", message = msg }), ct);
            session.Dispose();
        }
    }

    private void CloseSession(string sessionId, string reason)
    {
        if (_sessions.TryRemove(sessionId, out var s))
        {
            try { s.Dispose(); } catch { }
            _logger.LogInformation("Desktop tunnel session closed {SessionId} ({Reason})", sessionId, reason);
        }
    }

    private static async Task SendText(ClientWebSocket ws, string text, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    private static async Task SendBinary(ClientWebSocket ws, byte[] data, CancellationToken ct)
    {
        await ws.SendAsync(new ArraySegment<byte>(data), WebSocketMessageType.Binary, true, ct);
    }

    // ---------------- Framing ----------------

    private readonly record struct DataFrame(string SessionId, byte[] Payload);

    private static byte[] EncodeDataFrame(string sessionId, byte[] payload)
    {
        // byte frameType(0x01) + uint16be sidLen + sidUtf8 + payload
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

    // ---------------- Session ----------------

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
                _logger.LogWarning(ex, "WriteToTcp failed session {SessionId}", _sessionId);
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
