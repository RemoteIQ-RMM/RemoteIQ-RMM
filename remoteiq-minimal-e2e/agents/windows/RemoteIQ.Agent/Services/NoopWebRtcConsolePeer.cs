// agents/windows/RemoteIQ.Agent/Services/NoopWebRtcConsolePeer.cs

using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class NoopWebRtcConsolePeer : IWebRtcConsolePeer
{
    private readonly ILogger _log;
    private IntPtr _h;
    private NativeMethods.RcCallbacks _cbs;
    private readonly GCHandle _selfHandle;

    private readonly Channel<Action> _cbQueue = Channel.CreateUnbounded<Action>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

    private volatile bool _closed;

    public string SessionId { get; }
    public bool IsConnected { get; private set; }

    public event Action<string>? OnTextFromTech;
    public event Action<JsonElement>? OnControlFromTech;
    public event Action<object>? OnSignalToSend;

    public NoopWebRtcConsolePeer(string sessionId, ILogger log)
    {
        SessionId = sessionId;
        _log = log;

        _selfHandle = GCHandle.Alloc(this);

        NativeMethods.ManagedOnSignal = OnSignalFromNative;
        NativeMethods.ManagedOnState = OnStateFromNative;
        NativeMethods.ManagedOnData = OnDataFromNative;
        NativeMethods.ManagedOnLog = OnLogFromNative;

        _cbs = NativeMethods.BuildUnmanagedCallbacks(GCHandle.ToIntPtr(_selfHandle));

        var cfgJson = "{\"iceServers\":[],\"sessionId\":\"" + sessionId + "\"}";
        var rc = NativeMethods.rc_peer_create(cfgJson, ref _cbs, out _h);
        if (rc != 0 || _h == IntPtr.Zero)
            throw new InvalidOperationException($"rc_peer_create failed rc={rc}");

        _ = Task.Run(ProcessCallbacksLoop);
    }

    private static void OnSignalFromNative(IntPtr utf8Json, IntPtr user)
    {
        var self = FromUser(user);
        var json = NativeMethods.PtrToUtf8String(utf8Json);

        self.Enqueue(() =>
        {
            if (string.IsNullOrWhiteSpace(json)) return;

            try
            {
                using var doc = JsonDocument.Parse(json);
                self.OnSignalToSend?.Invoke(doc.RootElement.Clone());
            }
            catch
            {
                self.OnSignalToSend?.Invoke(new { type = "native.signal", text = json });
            }
        });
    }

    private static void OnStateFromNative(int state, IntPtr user)
    {
        var self = FromUser(user);

        self.Enqueue(() =>
        {
            self.IsConnected = (state == 2);
            self._log.LogInformation("NativeWebRtc state session={SessionId} state={State}", self.SessionId, state);
        });
    }

    private static void OnDataFromNative(IntPtr labelUtf8, IntPtr data, int len, IntPtr user)
    {
        var self = FromUser(user);
        if (len <= 0 || data == IntPtr.Zero) return;

        var buf = new byte[len];
        Marshal.Copy(data, buf, 0, len);

        var label = NativeMethods.PtrToUtf8String(labelUtf8);

        self.Enqueue(() =>
        {
            if (string.Equals(label, "rc.input", StringComparison.OrdinalIgnoreCase))
            {
                var text = Encoding.UTF8.GetString(buf);
                self.OnTextFromTech?.Invoke(text);
                return;
            }

            if (string.Equals(label, "rc.control", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    using var doc = JsonDocument.Parse(buf);
                    self.OnControlFromTech?.Invoke(doc.RootElement.Clone());
                }
                catch { }
            }
        });
    }

    private static void OnLogFromNative(int level, IntPtr msgUtf8, IntPtr user)
    {
        var self = FromUser(user);
        var msg = NativeMethods.PtrToUtf8String(msgUtf8);

        self.Enqueue(() =>
        {
            if (string.IsNullOrWhiteSpace(msg)) return;

            if (level <= 1) self._log.LogDebug("NativeWebRtc: {Msg}", msg);
            else if (level == 2) self._log.LogInformation("NativeWebRtc: {Msg}", msg);
            else self._log.LogWarning("NativeWebRtc: {Msg}", msg);
        });
    }

    private void Enqueue(Action a)
    {
        if (_closed) return;
        _cbQueue.Writer.TryWrite(a);
    }

    private static NoopWebRtcConsolePeer FromUser(IntPtr user)
    {
        var gch = GCHandle.FromIntPtr(user);
        return (NoopWebRtcConsolePeer)gch.Target!;
    }

    private async Task ProcessCallbacksLoop()
    {
        try
        {
            while (await _cbQueue.Reader.WaitToReadAsync().ConfigureAwait(false))
            {
                while (_cbQueue.Reader.TryRead(out var a))
                {
                    try { a(); }
                    catch { }
                }
            }
        }
        catch { }
    }

    public Task HandleSignalAsync(object signalData, CancellationToken ct)
    {
        if (ct.IsCancellationRequested || _closed) return Task.CompletedTask;

        string json;
        try
        {
            if (signalData is JsonElement je) json = je.GetRawText();
            else if (signalData is string s) json = s;
            else json = JsonSerializer.Serialize(signalData);
        }
        catch
        {
            return Task.CompletedTask;
        }

        try { NativeMethods.rc_peer_handle_signal(_h, json); } catch { }
        return Task.CompletedTask;
    }

    public Task SendTextAsync(string text, CancellationToken ct)
    {
        if (ct.IsCancellationRequested || _closed) return Task.CompletedTask;

        var bytes = Encoding.UTF8.GetBytes(text ?? string.Empty);
        try { _ = NativeMethods.rc_peer_send(_h, "rc.input", bytes, bytes.Length); } catch { }
        return Task.CompletedTask;
    }

    public Task CloseAsync(string reason, CancellationToken ct)
    {
        if (_closed) return Task.CompletedTask;
        _closed = true;

        try { NativeMethods.rc_peer_close(_h, reason ?? "closed"); } catch { }
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        if (_closed == false)
            await CloseAsync("dispose", CancellationToken.None).ConfigureAwait(false);

        try
        {
            if (_h != IntPtr.Zero)
                NativeMethods.rc_peer_destroy(_h);
        }
        catch { }

        _h = IntPtr.Zero;

        try { _cbQueue.Writer.TryComplete(); } catch { }

        try
        {
            if (_selfHandle.IsAllocated) _selfHandle.Free();
        }
        catch { }
    }
}
