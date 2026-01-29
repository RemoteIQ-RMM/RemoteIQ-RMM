using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using static RemoteIq.Agent.RemoteShell.ConPtyNative;

namespace RemoteIq.Agent.RemoteShell
{
    public enum ShellRunAs
    {
        System = 0,
        LoggedInUser = 1
    }

    public sealed class ConPtyShellSession : IShellSession
    {
        private readonly string _sessionId;
        private readonly Func<string, string, CancellationToken, Task> _sendData;
        private readonly Func<string, int?, string?, string?, CancellationToken, Task> _sendExit;
        private readonly ShellRunAs _runAs;

        private CancellationTokenSource? _cts;

        private HPCON _hPC;
        private IntPtr _hInRead = IntPtr.Zero;
        private IntPtr _hInWrite = IntPtr.Zero;
        private IntPtr _hOutRead = IntPtr.Zero;
        private IntPtr _hOutWrite = IntPtr.Zero;

        private IntPtr _hProcess = IntPtr.Zero;
        private IntPtr _hThread = IntPtr.Zero;

        // --- user profile dir resolution (for lpCurrentDirectory) ---
        private const int ERROR_INSUFFICIENT_BUFFER = 122;

        [DllImport("userenv.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool GetUserProfileDirectoryW(
            IntPtr hToken,
            StringBuilder lpProfileDir,
            ref uint lpcchSize
        );

        public ConPtyShellSession(
            string sessionId,
            Func<string, string, CancellationToken, Task> sendData,
            Func<string, int?, string?, string?, CancellationToken, Task> sendExit,
            ShellRunAs runAs = ShellRunAs.System)
        {
            _sessionId = sessionId;
            _sendData = sendData;
            _sendExit = sendExit;
            _runAs = runAs;
        }

        public static bool IsSupported()
        {
            // ConPTY exists on Win10 1809+. We'll assume if kernel32 loads; CreatePseudoConsole will throw if missing.
            return OperatingSystem.IsWindows() && NativeLibrary.TryLoad("kernel32.dll", out _);
        }

        public Task StartAsync(int cols, int rows, CancellationToken ct)
        {
            _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);

            ThrowIfFalse(CreatePipe(out _hOutRead, out _hOutWrite, IntPtr.Zero, 0), "CreatePipe(out)");
            ThrowIfFalse(CreatePipe(out _hInRead, out _hInWrite, IntPtr.Zero, 0), "CreatePipe(in)");

            var size = new COORD { X = (short)cols, Y = (short)rows };
            int hr = CreatePseudoConsole(size, _hInRead, _hOutWrite, 0, out _hPC);
            if (hr != 0) throw new Win32Exception(hr, "CreatePseudoConsole failed");

            var cmdLine = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass";
            StartAttachedProcess(cmdLine, _runAs);

            _ = Task.Run(() => ReadLoop(_cts.Token));

            return Task.CompletedTask;
        }

        public async Task WriteAsync(string data, CancellationToken ct)
        {
            if (_hInWrite == IntPtr.Zero) return;
            var bytes = Encoding.UTF8.GetBytes(data);

            await Task.Run(() =>
            {
                if (!WriteFile(_hInWrite, bytes, (uint)bytes.Length, out var _, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "WriteFile failed");
            }, ct).ConfigureAwait(false);
        }

        public Task SignalAsync(string signal, CancellationToken ct)
        {
            if (string.Equals(signal, "SIGINT", StringComparison.OrdinalIgnoreCase))
                return WriteAsync("\x03", ct);

            try
            {
                if (_hProcess != IntPtr.Zero) TerminateProcess(_hProcess, 1);
            }
            catch { }

            return Task.CompletedTask;
        }

        public Task ResizeAsync(int cols, int rows, CancellationToken ct)
        {
            if (_hPC.Handle == IntPtr.Zero) return Task.CompletedTask;
            var size = new COORD { X = (short)cols, Y = (short)rows };
            _ = ResizePseudoConsole(_hPC, size);
            return Task.CompletedTask;
        }

        private async Task ReadLoop(CancellationToken ct)
        {
            var buf = new byte[8192];

            try
            {
                while (!ct.IsCancellationRequested && _hOutRead != IntPtr.Zero)
                {
                    if (!ReadFile(_hOutRead, buf, (uint)buf.Length, out var read, IntPtr.Zero))
                    {
                        break; // broken pipe -> exited
                    }

                    if (read == 0) break;

                    var s = Encoding.UTF8.GetString(buf, 0, (int)read);
                    await _sendData(_sessionId, s, ct).ConfigureAwait(false);
                }
            }
            catch (Exception ex)
            {
                await _sendExit(_sessionId, null, null, $"PTY read loop error: {ex.Message}", CancellationToken.None)
                    .ConfigureAwait(false);
            }
            finally
            {
                int? exit = null;
                try
                {
                    if (_hProcess != IntPtr.Zero && GetExitCodeProcess(_hProcess, out var code))
                        exit = (int)code;
                }
                catch { }

                await _sendExit(_sessionId, exit, null, "Process exited", CancellationToken.None).ConfigureAwait(false);
            }
        }

        private static string? TryGetUserProfileDirFromToken(IntPtr primaryToken)
        {
            try
            {
                uint size = 0;
                var sb0 = new StringBuilder(0);

                // First call should fail with INSUFFICIENT_BUFFER and set size
                _ = GetUserProfileDirectoryW(primaryToken, sb0, ref size);
                int err = Marshal.GetLastWin32Error();

                if (err != ERROR_INSUFFICIENT_BUFFER || size == 0)
                    return null;

                var sb = new StringBuilder((int)size);
                if (!GetUserProfileDirectoryW(primaryToken, sb, ref size))
                    return null;

                var s = sb.ToString().Trim();
                return string.IsNullOrWhiteSpace(s) ? null : s;
            }
            catch
            {
                return null;
            }
        }

        private static string? TryGetUserProfileDirViaImpersonation(IntPtr primaryToken)
        {
            try
            {
                using var id = new WindowsIdentity(primaryToken);
                return WindowsIdentity.RunImpersonated(id.AccessToken, () =>
                {
                    var p = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    return string.IsNullOrWhiteSpace(p) ? null : p;
                });
            }
            catch
            {
                return null;
            }
        }

        private void StartAttachedProcess(string commandLine, ShellRunAs runAs)
        {
            var siEx = new STARTUPINFOEX();
            siEx.StartupInfo.cb = Marshal.SizeOf<STARTUPINFOEX>();

            // Attribute list for ConPTY
            IntPtr lpSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref lpSize);
            siEx.lpAttributeList = Marshal.AllocHGlobal(lpSize);

            ThrowIfFalse(
                InitializeProcThreadAttributeList(siEx.lpAttributeList, 1, 0, ref lpSize),
                "InitializeProcThreadAttributeList"
            );

            // IMPORTANT: cbSize must be the size of the HPCON handle value passed in lpValue.
            // We pass the handle value (IntPtr) as lpValue, so cbSize is IntPtr.Size.
            ThrowIfFalse(
                UpdateProcThreadAttribute(
                    siEx.lpAttributeList,
                    0,
                    (IntPtr)PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                    _hPC.Handle,
                    (IntPtr)IntPtr.Size,
                    IntPtr.Zero,
                    IntPtr.Zero
                ),
                "UpdateProcThreadAttribute"
            );

            var pi = new PROCESS_INFORMATION();
            var cmd = new StringBuilder(commandLine);

            const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
            const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;

            IntPtr envBlock = IntPtr.Zero;
            string? userProfileDir = null;

            try
            {
                if (runAs == ShellRunAs.System)
                {
                    ThrowIfFalse(
                        CreateProcessW(
                            lpApplicationName: null,
                            lpCommandLine: cmd,
                            lpProcessAttributes: IntPtr.Zero,
                            lpThreadAttributes: IntPtr.Zero,
                            bInheritHandles: false,
                            dwCreationFlags: EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                            lpEnvironment: IntPtr.Zero,
                            lpCurrentDirectory: null,
                            lpStartupInfo: ref siEx,
                            lpProcessInformation: out pi
                        ),
                        "CreateProcessW"
                    );
                }
                else
                {
                    // Run as interactive logged-in user (service should be SYSTEM)
                    var sessionId = WTSGetActiveConsoleSessionId();
                    if (sessionId == 0xFFFFFFFF)
                        throw new InvalidOperationException("No active console session.");

                    if (!WTSQueryUserToken(sessionId, out var userToken))
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "WTSQueryUserToken failed");

                    try
                    {
                        // Duplicate to primary token required for CreateProcessAsUser
                        if (!DuplicateTokenEx(
                                userToken,
                                TOKEN_ALL_ACCESS,
                                IntPtr.Zero,
                                SECURITY_IMPERSONATION_LEVEL.SecurityImpersonation,
                                TOKEN_TYPE.TokenPrimary,
                                out var primaryToken))
                        {
                            throw new Win32Exception(Marshal.GetLastWin32Error(), "DuplicateTokenEx failed");
                        }

                        try
                        {
                            // Build env block so PowerShell gets user profile env vars
                            if (!CreateEnvironmentBlock(out envBlock, primaryToken, false))
                                envBlock = IntPtr.Zero; // optional; continue without

                            // Resolve user's profile dir for working directory (prevents starting in System32)
                            userProfileDir =
                                TryGetUserProfileDirFromToken(primaryToken)
                                ?? TryGetUserProfileDirViaImpersonation(primaryToken);

                            // Ensure it targets the interactive desktop
                            siEx.StartupInfo.lpDesktop = @"winsta0\default";

                            ThrowIfFalse(
                                CreateProcessAsUserW(
                                    hToken: primaryToken,
                                    lpApplicationName: null,
                                    lpCommandLine: cmd,
                                    lpProcessAttributes: IntPtr.Zero,
                                    lpThreadAttributes: IntPtr.Zero,
                                    bInheritHandles: false,
                                    dwCreationFlags: EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                                    lpEnvironment: envBlock,
                                    lpCurrentDirectory: userProfileDir, // ✅ start in user's home dir when possible
                                    lpStartupInfo: ref siEx,
                                    lpProcessInformation: out pi
                                ),
                                "CreateProcessAsUserW"
                            );
                        }
                        finally
                        {
                            if (primaryToken != IntPtr.Zero)
                                CloseHandle(primaryToken);
                        }
                    }
                    finally
                    {
                        if (userToken != IntPtr.Zero)
                            CloseHandle(userToken);
                    }
                }

                _hProcess = pi.hProcess;
                _hThread = pi.hThread;
            }
            finally
            {
                if (envBlock != IntPtr.Zero)
                {
                    try { DestroyEnvironmentBlock(envBlock); } catch { }
                }

                try { DeleteProcThreadAttributeList(siEx.lpAttributeList); } catch { }
                try { Marshal.FreeHGlobal(siEx.lpAttributeList); } catch { }
            }
        }

        public async ValueTask DisposeAsync()
        {
            try { _cts?.Cancel(); } catch { }

            try { if (_hProcess != IntPtr.Zero) TerminateProcess(_hProcess, 1); } catch { }

            try { if (_hThread != IntPtr.Zero) CloseHandle(_hThread); } catch { }
            try { if (_hProcess != IntPtr.Zero) CloseHandle(_hProcess); } catch { }

            try
            {
                if (_hPC.Handle != IntPtr.Zero)
                    ClosePseudoConsole(_hPC);
            }
            catch { }

            try { if (_hInRead != IntPtr.Zero) CloseHandle(_hInRead); } catch { }
            try { if (_hInWrite != IntPtr.Zero) CloseHandle(_hInWrite); } catch { }
            try { if (_hOutRead != IntPtr.Zero) CloseHandle(_hOutRead); } catch { }
            try { if (_hOutWrite != IntPtr.Zero) CloseHandle(_hOutWrite); } catch { }

            _hInRead = _hInWrite = _hOutRead = _hOutWrite = IntPtr.Zero;
            _hProcess = _hThread = IntPtr.Zero;

            await Task.CompletedTask;
        }

        private static void ThrowIfFalse(bool ok, string name)
        {
            if (!ok)
                throw new Win32Exception(Marshal.GetLastWin32Error(), name);
        }
    }
}
