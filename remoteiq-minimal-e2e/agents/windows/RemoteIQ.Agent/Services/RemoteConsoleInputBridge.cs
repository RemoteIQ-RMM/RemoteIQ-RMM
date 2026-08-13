// agents/windows/RemoteIQ.Agent/Services/RemoteConsoleInputBridge.cs

using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

/// <summary>
/// Bridges IWebRtcConsolePeer.OnControlFromTech -> Windows input injection.
/// </summary>
public sealed class RemoteConsoleInputBridge : IAsyncDisposable
{
    private readonly ILogger _log;
    private readonly IWebRtcConsolePeer _peer;
    private readonly IRemoteConsoleInputInjector _injector;

    private volatile bool _disposed;

    public RemoteConsoleInputBridge(IWebRtcConsolePeer peer, IRemoteConsoleInputInjector injector, ILogger log)
    {
        _peer = peer;
        _injector = injector;
        _log = log;

        _peer.OnControlFromTech += HandleControl;
    }

    private void HandleControl(JsonElement payload)
    {
        if (_disposed) return;

        try
        {
            if (!RemoteConsoleControlProtocol.TryParse(payload, out var msg))
                return;

            // Preserve ordered rc.control DataChannel delivery.
            _injector.Apply(msg);
        }
        catch
        {
            // ignore bad packets
        }
    }

    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;

        try { _peer.OnControlFromTech -= HandleControl; } catch { }

        return ValueTask.CompletedTask;
    }
}
