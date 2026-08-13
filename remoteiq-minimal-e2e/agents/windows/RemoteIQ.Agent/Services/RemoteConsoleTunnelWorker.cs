// agents/windows/RemoteIQ.Agent/Services/RemoteConsoleTunnelWorker.cs

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

/// <summary>
/// Bridges WebRTC DataChannel text to an interactive PowerShell process.
/// - Tech -> Agent: incoming text written to stdin.
/// - Agent -> Tech: stdout/stderr streamed back over datachannel.
/// </summary>
public sealed class RemoteConsoleTunnelWorker : BackgroundService
{
    private readonly ILogger<RemoteConsoleTunnelWorker> _log;
    private readonly IWebRtcConsolePeerFactory _peerFactory;

    // IMPORTANT:
    // This worker does not create peers itself; the RemoteConsoleWorker does.
    // However, we still need a way to attach tunnel sessions to peers.
    //
    // To keep this file self-contained and not require invasive changes,
    // we use a simple static registry that peers can register into.
    public static readonly ConcurrentDictionary<string, IWebRtcConsolePeer> ActivePeers = new();

    private readonly ConcurrentDictionary<string, TerminalSession> _terms = new();

    public RemoteConsoleTunnelWorker(
        ILogger<RemoteConsoleTunnelWorker> log,
        IWebRtcConsolePeerFactory peerFactory)
    {
        _log = log;
        _peerFactory = peerFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Poll loop: attach terminal sessions for any peer that doesn’t have one yet.
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                foreach (var kv in ActivePeers)
                {
                    var sessionId = kv.Key;
                    var peer = kv.Value;

                    if (_terms.ContainsKey(sessionId)) continue;

                    var term = new TerminalSession(sessionId, peer, _log);
                    if (_terms.TryAdd(sessionId, term))
                    {
                        term.Start(stoppingToken);
                        _log.LogInformation("RemoteConsole terminal attached session={SessionId}", sessionId);
                    }
                }

                // Remove terminals whose peers went away
                foreach (var kv in _terms)
                {
                    var sid = kv.Key;
                    if (!ActivePeers.ContainsKey(sid))
                    {
                        if (_terms.TryRemove(sid, out var t))
                        {
                            t.Dispose();
                            _log.LogInformation("RemoteConsole terminal detached session={SessionId}", sid);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "RemoteConsoleTunnelWorker loop error");
            }

            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }

        foreach (var kv in _terms)
        {
            try { kv.Value.Dispose(); } catch { }
        }
        _terms.Clear();
    }

    private sealed class TerminalSession : IDisposable
    {
        private readonly string _sessionId;
        private readonly IWebRtcConsolePeer _peer;
        private readonly ILogger _log;

        private Process? _proc;
        private volatile bool _disposed;

        public TerminalSession(string sessionId, IWebRtcConsolePeer peer, ILogger log)
        {
            _sessionId = sessionId;
            _peer = peer;
            _log = log;
        }

        public void Start(CancellationToken ct)
        {
            // listen for tech input
            _peer.OnTextFromTech += OnTechText;

            // spawn PowerShell
            _proc = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass",
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8
                },
                EnableRaisingEvents = true
            };

            _proc.Exited += (_, __) =>
            {
                _ = SafeSendAsync($"\r\n[RemoteIQ] PowerShell exited.\r\n", CancellationToken.None);
                Dispose();
            };

            _proc.Start();

            // stream stdout/stderr
            _ = Task.Run(() => PumpReader(_proc.StandardOutput, ct), ct);
            _ = Task.Run(() => PumpReader(_proc.StandardError, ct), ct);

            _ = SafeSendAsync("[RemoteIQ] PowerShell session started.\r\n", ct);
        }

        private void OnTechText(string text)
        {
            if (_disposed) return;
            var p = _proc;
            if (p == null || p.HasExited) return;

            try
            {
                // Normalize to Windows newlines; tech terminal usually sends \n
                var t = text.Replace("\r\n", "\n").Replace("\n", "\r\n");
                p.StandardInput.Write(t);
                p.StandardInput.Flush();
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "RemoteConsole stdin write failed session={SessionId}", _sessionId);
            }
        }

        private async Task PumpReader(System.IO.StreamReader reader, CancellationToken ct)
        {
            var buf = new char[4096];

            while (!ct.IsCancellationRequested && !_disposed)
            {
                int read;
                try
                {
                    read = await reader.ReadAsync(buf, 0, buf.Length);
                }
                catch
                {
                    break;
                }

                if (read <= 0) break;

                var chunk = new string(buf, 0, read);
                await SafeSendAsync(chunk, ct);
            }
        }

        private Task SafeSendAsync(string text, CancellationToken ct)
        {
            // best effort — remote console should keep moving
            try
            {
                return _peer.SendTextAsync(text, ct);
            }
            catch
            {
                return Task.CompletedTask;
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            try { _peer.OnTextFromTech -= OnTechText; } catch { }

            try
            {
                if (_proc != null && !_proc.HasExited)
                {
                    _proc.Kill(entireProcessTree: true);
                }
            }
            catch { }

            try { _proc?.Dispose(); } catch { }
            _proc = null;
        }
    }
}
