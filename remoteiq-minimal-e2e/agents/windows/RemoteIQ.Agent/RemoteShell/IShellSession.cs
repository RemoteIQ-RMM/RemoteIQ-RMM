// agents/windows/RemoteIQ.Agent/RemoteShell/IShellSession.cs

using System;
using System.Threading;
using System.Threading.Tasks;

namespace RemoteIq.Agent.RemoteShell;

public interface IShellSession : IAsyncDisposable
{
    Task StartAsync(int cols, int rows, CancellationToken ct);

    Task WriteAsync(string data, CancellationToken ct);

    Task ResizeAsync(int cols, int rows, CancellationToken ct);

    /// <summary>
    /// Signal is usually "SIGINT" or "SIGTERM" (mapped internally on Windows).
    /// </summary>
    Task SignalAsync(string signal, CancellationToken ct);
}
