// agents/windows/RemoteIQ.Agent/Services/IRemoteConsoleInputInjector.cs

using System.Threading;
using System.Threading.Tasks;

namespace RemoteIQ.Agent.Services;

/// <summary>
/// Applies parsed rc.control messages to the local machine input stack (mouse/keyboard/text).
/// </summary>
public interface IRemoteConsoleInputInjector
{
    /// <summary>
    /// Synchronous apply (fast path). Implementations should be non-blocking.
    /// </summary>
    void Apply(RemoteConsoleControlProtocol.ControlMessage msg);

    /// <summary>
    /// Async apply (used by the bridge/peer). Default behavior calls Apply().
    /// </summary>
    Task ApplyAsync(RemoteConsoleControlProtocol.ControlMessage msg, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return Task.CompletedTask;
        Apply(msg);
        return Task.CompletedTask;
    }
}
