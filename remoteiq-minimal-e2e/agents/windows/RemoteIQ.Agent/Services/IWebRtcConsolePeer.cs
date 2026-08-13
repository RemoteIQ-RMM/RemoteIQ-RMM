// agents/windows/RemoteIQ.Agent/Services/IWebRtcConsolePeer.cs

using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace RemoteIQ.Agent.Services;

public interface IWebRtcConsolePeer : IAsyncDisposable
{
    string SessionId { get; }

    /// <summary>
    /// Called when the WS signaling layer receives "signal" messages for this session.
    /// The payload is whatever the browser sends (offer/answer/candidate).
    /// </summary>
    Task HandleSignalAsync(object signalData, CancellationToken ct);

    /// <summary>
    /// True once peer connection is established (best-effort).
    /// </summary>
    bool IsConnected { get; }

    /// <summary>
    /// Send text back to the technician over the data channel (terminal output).
    /// Safe to call even if not connected yet.
    /// </summary>
    Task SendTextAsync(string text, CancellationToken ct);

    /// <summary>
    /// Fired when text is received from the technician over the data channel (terminal input).
    /// </summary>
    event Action<string>? OnTextFromTech;

    /// <summary>
    /// Fired when a desktop control message is received from the technician over the data channel (rc.control).
    /// Payload is JSON (mouse/keyboard/etc).
    /// </summary>
    event Action<JsonElement>? OnControlFromTech;

    /// <summary>
    /// Fired when we need to send a signaling message back to the server (SDP/ICE).
    /// </summary>
    event Action<object>? OnSignalToSend;

    /// <summary>
    /// Close the peer.
    /// </summary>
    Task CloseAsync(string reason, CancellationToken ct);
}
