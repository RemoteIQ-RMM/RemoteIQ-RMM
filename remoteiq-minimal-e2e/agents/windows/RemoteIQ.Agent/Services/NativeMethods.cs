// agents/windows/RemoteIQ.Agent/Services/NativeMethods.cs

using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace RemoteIQ.Agent.Services;

internal static unsafe class NativeMethods
{
    private const string DllName = "RemoteIQ.NativeWebRtc";

    // If native expects a larger struct than our managed definition, we pass an oversized,
    // zero-filled blob with our struct at offset 0. This avoids AVs from native reading
    // beyond our managed size.
    private const int CallbackBlobSize = 128;

    [StructLayout(LayoutKind.Sequential)]
    internal struct RcCallbacks
    {
        public IntPtr on_signal;
        public IntPtr on_connection_state;
        public IntPtr on_data_message;
        public IntPtr on_log;
        public IntPtr user;
    }

    internal static Action<IntPtr, IntPtr>? ManagedOnSignal;
    internal static Action<int, IntPtr>? ManagedOnState;
    internal static Action<IntPtr, IntPtr, int, IntPtr>? ManagedOnData;
    internal static Action<int, IntPtr, IntPtr>? ManagedOnLog;

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    private static void OnSignalTrampoline(IntPtr utf8Json, IntPtr user)
    {
        try { ManagedOnSignal?.Invoke(utf8Json, user); } catch { }
    }

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    private static void OnStateTrampoline(int state, IntPtr user)
    {
        try { ManagedOnState?.Invoke(state, user); } catch { }
    }

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    private static void OnDataTrampoline(IntPtr labelUtf8, IntPtr data, int len, IntPtr user)
    {
        try { ManagedOnData?.Invoke(labelUtf8, data, len, user); } catch { }
    }

    [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
    private static void OnLogTrampoline(int level, IntPtr msgUtf8, IntPtr user)
    {
        try { ManagedOnLog?.Invoke(level, msgUtf8, user); } catch { }
    }

    // ------------------------- Callback builders -------------------------

    internal static RcCallbacks BuildNullCallbacks() => new()
    {
        on_signal = IntPtr.Zero,
        on_connection_state = IntPtr.Zero,
        on_data_message = IntPtr.Zero,
        on_log = IntPtr.Zero,
        user = IntPtr.Zero,
    };

    internal static RcCallbacks BuildLogOnlyCallbacks(IntPtr userPtr) => new()
    {
        on_signal = IntPtr.Zero,
        on_connection_state = IntPtr.Zero,
        on_data_message = IntPtr.Zero,
        on_log = (IntPtr)(delegate* unmanaged[Cdecl]<int, IntPtr, IntPtr, void>)&OnLogTrampoline,
        user = userPtr,
    };

    internal static RcCallbacks BuildSignalOnlyCallbacks(IntPtr userPtr) => new()
    {
        on_signal = (IntPtr)(delegate* unmanaged[Cdecl]<IntPtr, IntPtr, void>)&OnSignalTrampoline,
        on_connection_state = IntPtr.Zero,
        on_data_message = IntPtr.Zero,
        on_log = IntPtr.Zero,
        user = userPtr,
    };

    internal static RcCallbacks BuildStateOnlyCallbacks(IntPtr userPtr) => new()
    {
        on_signal = IntPtr.Zero,
        on_connection_state = (IntPtr)(delegate* unmanaged[Cdecl]<int, IntPtr, void>)&OnStateTrampoline,
        on_data_message = IntPtr.Zero,
        on_log = IntPtr.Zero,
        user = userPtr,
    };

    internal static RcCallbacks BuildDataOnlyCallbacks(IntPtr userPtr) => new()
    {
        on_signal = IntPtr.Zero,
        on_connection_state = IntPtr.Zero,
        on_data_message = (IntPtr)(delegate* unmanaged[Cdecl]<IntPtr, IntPtr, int, IntPtr, void>)&OnDataTrampoline,
        on_log = IntPtr.Zero,
        user = userPtr,
    };

    internal static RcCallbacks BuildAllCallbacks(IntPtr userPtr) => new()
    {
        on_signal = (IntPtr)(delegate* unmanaged[Cdecl]<IntPtr, IntPtr, void>)&OnSignalTrampoline,
        on_connection_state = (IntPtr)(delegate* unmanaged[Cdecl]<int, IntPtr, void>)&OnStateTrampoline,
        on_data_message = (IntPtr)(delegate* unmanaged[Cdecl]<IntPtr, IntPtr, int, IntPtr, void>)&OnDataTrampoline,
        on_log = (IntPtr)(delegate* unmanaged[Cdecl]<int, IntPtr, IntPtr, void>)&OnLogTrampoline,
        user = userPtr,
    };

    // Compatibility shims used by other peers
    internal static RcCallbacks BuildUnmanagedCallbacks() => BuildAllCallbacks(IntPtr.Zero);
    internal static RcCallbacks BuildUnmanagedCallbacks(IntPtr userPtr) => BuildAllCallbacks(userPtr);

    // ---------------------------- P/Invoke ----------------------------

    // ✅ CDECL: header doesn't declare WINAPI/__stdcall; cdecl is the default.
    // Note: This was missing from your grep output because it starts with rc_abi, not rc_peer.
    // Since it worked in the logs ("NativeWebRtc ABI version: 1"), we leave it as is.
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    internal static extern int rc_abi_version();

    // Raw import that matches the native signature:
    // int rc_peer_create(const char* config_json_utf8, const rc_callbacks_t* cbs, rc_peer_handle_t* out_handle);
    // FIX APPLIED HERE: Added EntryPoint = "rc_peer_create" to map the C# name to the DLL export.
    [DllImport(DllName, EntryPoint = "rc_peer_create", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern int rc_peer_create_raw(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string config_json_utf8,
        IntPtr cbs,
        out IntPtr out_handle);

    /// <summary>
    /// Call-sites in your code currently pass an IntPtr for callbacks. We accept it,
    /// but we wrap it into an oversized blob to be tolerant to native struct-size differences.
    /// </summary>
    internal static int rc_peer_create(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string config_json_utf8,
        IntPtr cbs,
        out IntPtr out_handle)
    {
        IntPtr mem = IntPtr.Zero;
        try
        {
            mem = Marshal.AllocHGlobal(CallbackBlobSize);

            // Zero-fill entire blob so any extra native fields are null.
            new Span<byte>((void*)mem, CallbackBlobSize).Clear();

            if (cbs != IntPtr.Zero)
            {
                int copyBytes = sizeof(RcCallbacks);
                if (copyBytes > CallbackBlobSize) copyBytes = CallbackBlobSize;

                Buffer.MemoryCopy((void*)cbs, (void*)mem, CallbackBlobSize, copyBytes);
            }

            return rc_peer_create_raw(config_json_utf8, mem, out out_handle);
        }
        finally
        {
            if (mem != IntPtr.Zero)
                Marshal.FreeHGlobal(mem);
        }
    }

    /// <summary>
    /// Convenience overload for callers that still use ref RcCallbacks.
    /// </summary>
    internal static int rc_peer_create(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string config_json_utf8,
        ref RcCallbacks cbs,
        out IntPtr out_handle)
    {
        IntPtr mem = IntPtr.Zero;
        try
        {
            mem = Marshal.AllocHGlobal(CallbackBlobSize);

            new Span<byte>((void*)mem, CallbackBlobSize).Clear();

            // Write our known layout at the start of the blob.
            *(RcCallbacks*)mem = cbs;

            return rc_peer_create_raw(config_json_utf8, mem, out out_handle);
        }
        finally
        {
            if (mem != IntPtr.Zero)
                Marshal.FreeHGlobal(mem);
        }
    }

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    internal static extern void rc_peer_destroy(IntPtr handle);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    internal static extern void rc_peer_close(
        IntPtr handle,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string reason_utf8);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    internal static extern void rc_peer_handle_signal(
        IntPtr handle,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string signal_json_utf8);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    internal static extern int rc_peer_send(
        IntPtr handle,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string label_utf8,
        byte[] data,
        int len);

    internal static string PtrToUtf8String(IntPtr p)
        => p == IntPtr.Zero ? string.Empty : (Marshal.PtrToStringUTF8(p) ?? string.Empty);
}