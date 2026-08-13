// agents/windows/RemoteIQ.Agent/Services/InjectedWebRtcConsolePeer.cs

using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

/// <summary>
/// Decorator/wrapper around an IWebRtcConsolePeer that:
/// - listens to OnControlFromTech (rc.control)
/// - parses control protocol messages
/// - injects Windows input (SendInput)
/// </summary>
public sealed class InjectedWebRtcConsolePeer : IWebRtcConsolePeer
{
    private readonly IWebRtcConsolePeer _inner;
    private readonly IRemoteConsoleInputInjector _injector;
    private readonly ILogger _log;

    private volatile bool _disposed;

    public InjectedWebRtcConsolePeer(IWebRtcConsolePeer inner, ILoggerFactory loggerFactory, ILogger log)
    {
        _inner = inner;
        _log = log;

        // One injector instance per session/peer
        var injLogger = loggerFactory.CreateLogger<WindowsInputInjector>();
        _injector = new WindowsInputInjector(injLogger);

        // Hook control channel -> input injector
        _inner.OnControlFromTech += HandleControlFromTech;
    }

    public string SessionId => _inner.SessionId;
    public bool IsConnected => _inner.IsConnected;

    // Pass-through events (forward add/remove to inner)
    public event Action<string>? OnTextFromTech
    {
        add => _inner.OnTextFromTech += value;
        remove => _inner.OnTextFromTech -= value;
    }

    public event Action<JsonElement>? OnControlFromTech
    {
        add => _inner.OnControlFromTech += value;
        remove => _inner.OnControlFromTech -= value;
    }

    public event Action<object>? OnSignalToSend
    {
        add => _inner.OnSignalToSend += value;
        remove => _inner.OnSignalToSend -= value;
    }

    public Task HandleSignalAsync(object signalData, CancellationToken ct)
        => _inner.HandleSignalAsync(signalData, ct);

    public Task SendTextAsync(string text, CancellationToken ct)
        => _inner.SendTextAsync(text, ct);

    public Task CloseAsync(string reason, CancellationToken ct)
        => _inner.CloseAsync(reason, ct);

    private void HandleControlFromTech(JsonElement payload)
    {
        if (_disposed) return;

        try
        {
            if (!RemoteConsoleControlProtocol.TryParse(payload, out var msg))
                return;

            // Preserve ordered rc.control DataChannel delivery.
            // Do not dispatch each packet through an independent Task.Run:
            // key-down/up and mouse-down/up ordering must remain intact.
            _injector.Apply(msg);
        }
        catch
        {
            // ignore malformed packets
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        try { _inner.OnControlFromTech -= HandleControlFromTech; } catch { }

        await _inner.DisposeAsync().ConfigureAwait(false);
    }
}
