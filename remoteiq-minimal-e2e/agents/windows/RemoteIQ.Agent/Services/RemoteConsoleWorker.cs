// agents/windows/RemoteIQ.Agent/Services/RemoteConsoleWorker.cs

using System;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class RemoteConsoleWorker : BackgroundService
{
    private readonly ConfigService _cfg;
    private readonly IWebRtcConsolePeerFactory _peerFactory;
    private readonly ILogger<RemoteConsoleWorker> _log;

    private readonly ConcurrentDictionary<string, IWebRtcConsolePeer> _peers = new();

    private readonly JsonSerializerOptions _json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public RemoteConsoleWorker(
        ConfigService cfg,
        IWebRtcConsolePeerFactory peerFactory,
        ILogger<RemoteConsoleWorker> log)
    {
        _cfg = cfg;
        _peerFactory = peerFactory;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (string.IsNullOrWhiteSpace(_cfg.Current.AgentId) ||
                string.IsNullOrWhiteSpace(_cfg.Current.AgentKey) ||
                string.IsNullOrWhiteSpace(_cfg.Current.ApiBaseUrl))
            {
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
                continue;
            }

            var wsUri = BuildWsUri(_cfg.Current.ApiBaseUrl, "/ws/remote-console");
            if (wsUri is null)
            {
                _log.LogError("RemoteConsole invalid ApiBaseUrl for WS: {ApiBaseUrl}", _cfg.Current.ApiBaseUrl);
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                continue;
            }

            using var ws = new ClientWebSocket();
            ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

            try
            {
                await ws.ConnectAsync(wsUri, stoppingToken);
                _log.LogInformation("RemoteConsole WS connected: {Uri}", wsUri);

                // hello as agent (matches backend RemoteConsoleService)
                await SendJsonAsync(ws, new
                {
                    type = "hello",
                    kind = "agent",
                    agentUuid = _cfg.Current.AgentId.Trim(),
                    agentToken = _cfg.Current.AgentKey.Trim(),
                }, stoppingToken);

                await ReceiveLoop(ws, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (WebSocketException wse)
            {
                _log.LogWarning(wse, "RemoteConsole WS error; reconnecting in 5s");
                await CleanupAllPeers("ws_error");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "RemoteConsole WS error; reconnecting in 5s");
                await CleanupAllPeers("ws_error");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }

        await CleanupAllPeers("service_stop");
    }

    private async Task ReceiveLoop(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];

        while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            using var ms = new System.IO.MemoryStream();
            WebSocketReceiveResult? res;

            do
            {
                res = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                if (res.MessageType == WebSocketMessageType.Close)
                {
                    try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "closing", CancellationToken.None); }
                    catch { }
                    return;
                }

                if (res.Count > 0)
                    ms.Write(buffer, 0, res.Count);

            } while (!res.EndOfMessage);

            if (ms.Length == 0) continue;
            if (res.MessageType != WebSocketMessageType.Text) continue;

            var text = Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
            if (string.IsNullOrWhiteSpace(text)) continue;

            await HandleServerMessage(ws, text, ct);
        }
    }

    private async Task HandleServerMessage(ClientWebSocket ws, string text, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;

            if (!root.TryGetProperty("type", out var typeEl)) return;
            var type = typeEl.GetString() ?? "";

            if (type == "ping")
            {
                var ts = root.TryGetProperty("ts", out var tsEl) && tsEl.ValueKind == JsonValueKind.Number
                    ? tsEl.GetInt64()
                    : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                await SendJsonAsync(ws, new { type = "pong", ts }, ct);
                return;
            }

            if (type == "hello.ok" || type == "hello.error")
            {
                _log.LogInformation("RemoteConsole hello response: {Text}", text);
                return;
            }

            if (type == "session.ready")
            {
                var sessionId = ReadString(root, "sessionId");
                if (string.IsNullOrWhiteSpace(sessionId)) return;

                EnsurePeer(sessionId, ws, ct);
                _log.LogInformation("RemoteConsole session ready: {SessionId}", sessionId);
                return;
            }

            if (type == "session.closed")
            {
                var sessionId = ReadString(root, "sessionId");
                var reason = ReadString(root, "reason") ?? "closed";
                if (!string.IsNullOrWhiteSpace(sessionId))
                {
                    await RemovePeer(sessionId, $"server_closed:{reason}", ct);
                }
                return;
            }

            if (type == "signal")
            {
                var sessionId = ReadString(root, "sessionId");
                if (string.IsNullOrWhiteSpace(sessionId)) return;

                if (!root.TryGetProperty("data", out var dataEl)) return;

                // ✅ IMPORTANT: Clone the JsonElement so it survives beyond this JsonDocument's lifetime.
                // This prevents subtle signaling failures if the peer processes the payload asynchronously.
                if (dataEl.ValueKind == JsonValueKind.Undefined || dataEl.ValueKind == JsonValueKind.Null) return;
                var cloned = dataEl.Clone();

                var peer = EnsurePeer(sessionId, ws, ct);
                await peer.HandleSignalAsync((object)cloned, ct);
                return;
            }
        }
        catch (JsonException)
        {
            // ignore
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "RemoteConsole HandleServerMessage error");
        }
    }

    private IWebRtcConsolePeer EnsurePeer(string sessionId, ClientWebSocket ws, CancellationToken ct)
    {
        return _peers.GetOrAdd(sessionId, sid =>
        {
            var p = _peerFactory.Create(sid);

            // ✅ CRITICAL: register peer so RemoteConsoleTunnelWorker can attach PowerShell
            RemoteConsoleTunnelWorker.ActivePeers[sid] = p;

            // The peer tells us what signaling messages to send back to the backend WS.
            p.OnSignalToSend += (signalObj) =>
            {
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await SendJsonAsync(ws, new
                        {
                            type = "signal",
                            sessionId = sid,
                            data = signalObj
                        }, ct);
                    }
                    catch
                    {
                        // ignore
                    }
                }, CancellationToken.None);
            };

            return p;
        });
    }

    private async Task RemovePeer(string sessionId, string reason, CancellationToken ct)
    {
        if (_peers.TryRemove(sessionId, out var peer))
        {
            // ✅ unregister tunnel peer
            try { RemoteConsoleTunnelWorker.ActivePeers.TryRemove(sessionId, out _); } catch { }

            try { await peer.CloseAsync(reason, ct); } catch { }
            try { await peer.DisposeAsync(); } catch { }
        }
        else
        {
            // still ensure registry is clean
            try { RemoteConsoleTunnelWorker.ActivePeers.TryRemove(sessionId, out _); } catch { }
        }
    }

    private async Task CleanupAllPeers(string reason)
    {
        foreach (var kv in _peers)
        {
            var sid = kv.Key;
            var peer = kv.Value;

            // ✅ unregister tunnel peer
            try { RemoteConsoleTunnelWorker.ActivePeers.TryRemove(sid, out _); } catch { }

            try { await peer.CloseAsync(reason, CancellationToken.None); } catch { }
            try { await peer.DisposeAsync(); } catch { }
        }
        _peers.Clear();

        // ✅ hard clear registry too (safety)
        try { RemoteConsoleTunnelWorker.ActivePeers.Clear(); } catch { }
    }

    private static Uri? BuildWsUri(string apiBaseUrl, string wsPath)
    {
        if (string.IsNullOrWhiteSpace(apiBaseUrl)) return null;
        if (!Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var u)) return null;

        var scheme = u.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";

        var b = new UriBuilder(u)
        {
            Scheme = scheme,
            Path = wsPath,
            Query = ""
        };

        return b.Uri;
    }

    private async Task SendJsonAsync(ClientWebSocket ws, object payload, CancellationToken ct)
    {
        if (ws.State != WebSocketState.Open) return;

        var json = JsonSerializer.Serialize(payload, _json);
        var bytes = Encoding.UTF8.GetBytes(json);

        await ws.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancellationToken: ct);
    }

    private static string? ReadString(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var el)) return null;
        return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
    }
}
