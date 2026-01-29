using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace RemoteIq.Agent.RemoteShell
{
    public sealed class BasicShellSession : IShellSession
    {
        private readonly string _sessionId;
        private readonly Func<string, string, CancellationToken, Task> _sendData;
        private readonly Func<string, int?, string?, string?, CancellationToken, Task> _sendExit;

        private Process? _proc;
        private StreamWriter? _stdin;
        private CancellationTokenSource? _cts;

        public BasicShellSession(
            string sessionId,
            Func<string, string, CancellationToken, Task> sendData,
            Func<string, int?, string?, string?, CancellationToken, Task> sendExit)
        {
            _sessionId = sessionId;
            _sendData = sendData;
            _sendExit = sendExit;
        }

        public Task StartAsync(int cols, int rows, CancellationToken ct)
        {
            _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass",
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };

            _proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _proc.Exited += async (_, __) =>
            {
                try
                {
                    var code = _proc?.HasExited == true ? _proc.ExitCode : (int?)null;
                    await _sendExit(_sessionId, code, null, "Process exited", CancellationToken.None).ConfigureAwait(false);
                }
                catch { }
            };

            if (!_proc.Start())
                throw new InvalidOperationException("Failed to start powershell.exe");

            _stdin = _proc.StandardInput;

            _ = Task.Run(() => Pump(_proc.StandardOutput, _cts.Token));
            _ = Task.Run(() => Pump(_proc.StandardError, _cts.Token));

            return Task.CompletedTask;
        }

        private async Task Pump(StreamReader reader, CancellationToken ct)
        {
            var buf = new char[4096];
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    var n = await reader.ReadAsync(buf, 0, buf.Length).ConfigureAwait(false);
                    if (n <= 0) break;
                    await _sendData(_sessionId, new string(buf, 0, n), ct).ConfigureAwait(false);
                }
            }
            catch { }
        }

        public async Task WriteAsync(string data, CancellationToken ct)
        {
            if (_stdin == null) return;
            await _stdin.WriteAsync(data).ConfigureAwait(false);
            await _stdin.FlushAsync().ConfigureAwait(false);
        }

        public Task SignalAsync(string signal, CancellationToken ct)
        {
            // Basic mode can't reliably send Ctrl+C to a redirected process.
            // Best practical behavior: SIGINT => try write ^C, otherwise kill.
            if (string.Equals(signal, "SIGINT", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    _stdin?.Write("\x03");
                    _stdin?.Flush();
                    return Task.CompletedTask;
                }
                catch { }
            }

            try { _proc?.Kill(entireProcessTree: true); } catch { }
            return Task.CompletedTask;
        }

        public Task ResizeAsync(int cols, int rows, CancellationToken ct)
        {
            // No-op in basic mode.
            return Task.CompletedTask;
        }

        public async ValueTask DisposeAsync()
        {
            try { _cts?.Cancel(); } catch { }

            try { _stdin?.Close(); } catch { }

            try
            {
                if (_proc != null && !_proc.HasExited)
                    _proc.Kill(entireProcessTree: true);
            }
            catch { }

            try { _proc?.Dispose(); } catch { }

            await Task.CompletedTask;
        }
    }
}
