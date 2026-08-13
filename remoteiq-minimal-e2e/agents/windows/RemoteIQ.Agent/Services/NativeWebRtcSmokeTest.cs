// agents/windows/RemoteIQ.Agent/Services/NativeWebRtcSmokeTest.cs

using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace RemoteIQ.Agent.Services;

public static class NativeWebRtcSmokeTest
{
    // kernel32: print which native DLL path actually got loaded
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetModuleFileNameW(IntPtr hModule, StringBuilder lpFilename, int nSize);

    public static int Run(string[] args)
    {
        bool wantNull = Has(args, "--native-smoke-null");
        bool wantLogOnly = Has(args, "--native-smoke-logonly");
        bool wantSignalOnly = Has(args, "--native-smoke-signalonly");
        bool wantStateOnly = Has(args, "--native-smoke-stateonly");
        bool wantDataOnly = Has(args, "--native-smoke-dataonly");

        // Default behavior if none specified: ALL callbacks
        bool useAll = !(wantNull || wantLogOnly || wantSignalOnly || wantStateOnly || wantDataOnly);

        Console.WriteLine($"[smoke] pid={Process.GetCurrentProcess().Id}");
        Console.WriteLine($"[smoke] cwd={Environment.CurrentDirectory}");
        Console.WriteLine($"[smoke] baseDir={AppContext.BaseDirectory}");

        // Try loading the DLL up front so we can print the real path.
        // (This also helps catch missing dependency errors early.)
        TryPrintLoadedDllPath();

        int abi;
        try
        {
            abi = NativeMethods.rc_abi_version();
            Console.WriteLine($"NativeWebRtc ABI version: {abi}");
        }
        catch (DllNotFoundException ex)
        {
            Console.WriteLine("ERROR: RemoteIQ.NativeWebRtc.dll not found / not loadable.");
            Console.WriteLine(ex);
            return 10;
        }
        catch (EntryPointNotFoundException ex)
        {
            Console.WriteLine("ERROR: rc_abi_version() not found in the native DLL.");
            Console.WriteLine(ex);
            return 11;
        }

        // Wire managed handlers (invoked by trampolines)
        NativeMethods.ManagedOnSignal = (utf8Json, user) =>
        {
            Console.WriteLine("[native->signal] " + NativeMethods.PtrToUtf8String(utf8Json));
        };

        NativeMethods.ManagedOnState = (state, user) =>
        {
            Console.WriteLine("[native->state] " + state);
        };

        NativeMethods.ManagedOnData = (labelUtf8, data, len, user) =>
        {
            var label = NativeMethods.PtrToUtf8String(labelUtf8);
            Console.WriteLine($"[native->data] label={label} len={len}");

            if (len > 0 && len <= 256 && data != IntPtr.Zero)
            {
                var buf = new byte[len];
                Marshal.Copy(data, buf, 0, len);
                var preview = Encoding.UTF8.GetString(buf);
                Console.WriteLine($"[native->data] preview={preview}");
            }
        };

        NativeMethods.ManagedOnLog = (level, msgUtf8, user) =>
        {
            Console.WriteLine($"[native->log] L{level}: {NativeMethods.PtrToUtf8String(msgUtf8)}");
        };

        // Build callbacks struct
        NativeMethods.RcCallbacks cbs;
        if (wantNull)
        {
            Console.WriteLine("SmokeTest: using NULL callbacks.");
            cbs = NativeMethods.BuildNullCallbacks();
        }
        else if (wantLogOnly)
        {
            Console.WriteLine("SmokeTest: using LOG-ONLY callbacks.");
            cbs = NativeMethods.BuildLogOnlyCallbacks(IntPtr.Zero);
        }
        else if (wantSignalOnly)
        {
            Console.WriteLine("SmokeTest: using SIGNAL-ONLY callbacks.");
            cbs = NativeMethods.BuildSignalOnlyCallbacks(IntPtr.Zero);
        }
        else if (wantStateOnly)
        {
            Console.WriteLine("SmokeTest: using STATE-ONLY callbacks.");
            cbs = NativeMethods.BuildStateOnlyCallbacks(IntPtr.Zero);
        }
        else if (wantDataOnly)
        {
            Console.WriteLine("SmokeTest: using DATA-ONLY callbacks.");
            cbs = NativeMethods.BuildDataOnlyCallbacks(IntPtr.Zero);
        }
        else
        {
            Console.WriteLine("SmokeTest: using ALL callbacks.");
            cbs = NativeMethods.BuildAllCallbacks(IntPtr.Zero);
        }

        IntPtr handle = IntPtr.Zero;

        try
        {
            // Match your real peer config shape so native JSON parsing can’t be the reason.
            var configJson = "{\"iceServers\":[],\"sessionId\":\"smoke\"}";

            Console.WriteLine("[smoke] calling rc_peer_create...");
            Console.Out.Flush(); // if native aborts, we want this line printed

            int rc;

            try
            {
                rc = NativeMethods.rc_peer_create(configJson, ref cbs, out handle);
            }
            catch (SEHException ex)
            {
                Console.WriteLine("FATAL: SEHException thrown during rc_peer_create (native crash/abort likely).");
                Console.WriteLine(ex);
                return 98;
            }
            catch (AccessViolationException ex)
            {
                Console.WriteLine("FATAL: AccessViolationException thrown during rc_peer_create (native AV).");
                Console.WriteLine(ex);
                return 99;
            }

            Console.WriteLine($"rc_peer_create => {rc}, handle=0x{handle.ToInt64():X}");

            if (rc != 0 || handle == IntPtr.Zero)
            {
                Console.WriteLine("ERROR: rc_peer_create failed.");
                return 20;
            }

            // For smoke: just create/destroy. (Sending dummy SDP can assert in native.)
            NativeMethods.rc_peer_destroy(handle);
            handle = IntPtr.Zero;

            Console.WriteLine("NativeWebRtc smoke test done.");
            return 0;
        }
        finally
        {
            try
            {
                if (handle != IntPtr.Zero)
                    NativeMethods.rc_peer_destroy(handle);
            }
            catch { }
        }
    }

    private static void TryPrintLoadedDllPath()
    {
        try
        {
            // This loads RemoteIQ.NativeWebRtc.dll using the normal Windows search rules.
            if (!NativeLibrary.TryLoad("RemoteIQ.NativeWebRtc", out var h))
            {
                Console.WriteLine("[smoke] NativeLibrary.TryLoad(RemoteIQ.NativeWebRtc) => false");
                return;
            }

            var sb = new StringBuilder(2048);
            var n = GetModuleFileNameW(h, sb, sb.Capacity);
            if (n == 0)
            {
                Console.WriteLine("[smoke] Loaded native DLL but GetModuleFileNameW failed.");
                return;
            }

            Console.WriteLine("[smoke] Loaded native DLL path: " + sb.ToString());
        }
        catch (Exception ex)
        {
            Console.WriteLine("[smoke] Could not determine loaded DLL path.");
            Console.WriteLine(ex);
        }
    }

    private static bool Has(string[] args, string flag)
    {
        foreach (var a in args)
        {
            if (string.Equals(a, flag, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }
}
