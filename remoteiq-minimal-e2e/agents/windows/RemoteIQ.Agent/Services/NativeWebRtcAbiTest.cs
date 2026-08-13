using System;
using System.Runtime.InteropServices;

internal static class RemoteIqNativeWebRtc
{
    // IMPORTANT: your native exports are C ABI and should be cdecl.
    [DllImport("remoteiq_nativewebrtc.dll", EntryPoint = "rc_abi_version", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int RcAbiVersion();
}

public static class NativeWebRtcAbiTest
{
    public static void Run()
    {
        // If the DLL fails to load, you’ll get DllNotFoundException here.
        // If the export fails, you’ll get EntryPointNotFoundException.
        int v = RemoteIqNativeWebRtc.RcAbiVersion();
        Console.WriteLine($"[NativeWebRtc] rc_abi_version() = {v}");
    }
}
