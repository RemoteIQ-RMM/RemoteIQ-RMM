// agents/windows/RemoteIQ.Agent/Services/SipsorceryWebRtcConsolePeer.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;
using SIPSorceryMedia.Encoders;

namespace RemoteIQ.Agent.Services;

public sealed class SipsorceryWebRtcConsolePeer : IWebRtcConsolePeer
{
    private readonly ILogger _log;

    private RTCPeerConnection? _pc;

    private RTCDataChannel? _inputDc;   // rc.input
    private RTCDataChannel? _controlDc; // rc.control

    private volatile bool _closed;

    // Video pipeline
    private IVideoSource? _videoSource;
    private IVideoEncoder? _videoEncoder;
    private MediaStreamTrack? _videoTrack;
    private bool _videoAttached;
    private bool _videoStarted;

    // Encoder / bandwidth tuning
    private int _targetKbps;
    private int _maxKbps;
    private int _keyframeSeconds;
    private Timer? _keyframeTimer;

    // Desktop mapping (primary monitor in virtual screen coords)
    private DesktopGeometry _desktopGeom = DesktopGeometry.Unknown;

    // Input injection
    private readonly RemoteInputInjector _input = new();

    private static volatile bool _dcMembersDumped;

    public string SessionId { get; }
    public bool IsConnected { get; private set; }

    public event Action<string>? OnTextFromTech;
    public event Action<JsonElement>? OnControlFromTech;
    public event Action<object>? OnSignalToSend;

    public SipsorceryWebRtcConsolePeer(string sessionId, ILogger log)
    {
        SessionId = sessionId;
        _log = log;
        EnsurePeerCreated();
    }

    private void EnsurePeerCreated()
    {
        if (_pc != null) return;

        // Best-effort: make sure our process uses real pixel coordinates on modern Windows.
        DpiUtil.TryEnablePerMonitorV2();

        var stunRaw = (Environment.GetEnvironmentVariable("REMOTE_CONSOLE_STUN") ?? "").Trim();

        var iceServers = new List<RTCIceServer>();
        if (!string.IsNullOrWhiteSpace(stunRaw))
        {
            foreach (var s in stunRaw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                iceServers.Add(new RTCIceServer { urls = s });
            }
        }
        else
        {
            iceServers.Add(new RTCIceServer { urls = "stun:stun.l.google.com:19302" });
        }

        _pc = new RTCPeerConnection(new RTCConfiguration { iceServers = iceServers });

        _pc.onicecandidate += (cand) =>
        {
            if (_closed) return;
            if (cand == null) return;

            try
            {
                OnSignalToSend?.Invoke(new
                {
                    candidate = cand.candidate,
                    sdpMid = cand.sdpMid,
                    sdpMLineIndex = cand.sdpMLineIndex
                });
            }
            catch { }
        };

        _pc.onconnectionstatechange += async (state) =>
        {
            IsConnected = state == RTCPeerConnectionState.connected;
            _log.LogInformation("RemoteConsole WebRTC state session={SessionId} state={State}", SessionId, state);

            try
            {
                if (state == RTCPeerConnectionState.connected)
                {
                    await StartVideoIfReadyAsync().ConfigureAwait(false);
                    StartKeyframeTimer();
                }
                else if (state == RTCPeerConnectionState.failed || state == RTCPeerConnectionState.closed)
                {
                    StopKeyframeTimer();
                    await StopVideoBestEffortAsync().ConfigureAwait(false);
                }
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "RemoteConsole video start/stop hook error session={SessionId}", SessionId);
            }
        };

        _pc.oniceconnectionstatechange += (state) =>
        {
            _log.LogInformation("RemoteConsole ICE state session={SessionId} state={State}", SessionId, state);
        };

        _pc.ondatachannel += (dc) =>
        {
            if (_closed) return;
            if (dc == null) return;

            var label = (dc.label ?? "").Trim();
            _log.LogInformation("RemoteConsole datachannel received session={SessionId} label={Label}", SessionId, label);

            HookDataChannelDynamic(dc);

            if (string.Equals(label, "rc.control", StringComparison.OrdinalIgnoreCase))
            {
                _controlDc = dc;
                HookControlChannel(dc);
                return;
            }

            if (string.Equals(label, "rc.input", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(label, "console", StringComparison.OrdinalIgnoreCase))
            {
                _inputDc = dc;
                HookInputChannel(dc);
                return;
            }

            if (_inputDc == null)
            {
                _inputDc = dc;
                HookInputChannel(dc);
            }
        };

        try
        {
            EnableDesktopVideoPipeline(_pc);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "RemoteConsole video pipeline enable failed session={SessionId}", SessionId);
        }
    }

    // ---------------------------------------------------------------------
    // Desktop pipeline: helper in interactive session (Task Scheduler COM + Pipe)
    // ---------------------------------------------------------------------

    private void EnableDesktopVideoPipeline(RTCPeerConnection pc)
    {
        if (_videoSource != null || _videoAttached) return;

        var proc = Process.GetCurrentProcess();
        var isSession0 = proc.SessionId == 0;

        _log.LogInformation(
            "RemoteConsole runtime pid={Pid} sessionId={Sess} user={User} isSession0={IsSession0} os={OS} session={SessionId}",
            proc.Id,
            proc.SessionId,
            Environment.UserName,
            isSession0,
            Environment.OSVersion.VersionString,
            SessionId
        );

        var sourcePref = (Environment.GetEnvironmentVariable("REMOTE_CONSOLE_VIDEO_SOURCE") ?? "screen").Trim().ToLowerInvariant();
        var allowWebcam = (Environment.GetEnvironmentVariable("REMOTE_CONSOLE_ALLOW_WEBCAM") ?? "").Trim() == "1";

        if ((sourcePref == "camera" || sourcePref == "webcam") && !allowWebcam)
        {
            throw new InvalidOperationException("Webcam is disabled. Set REMOTE_CONSOLE_ALLOW_WEBCAM=1 to allow.");
        }

        _desktopGeom = DesktopGeometry.ReadCurrent(isSession0);

        var nativeW = Math.Max(1, _desktopGeom.Primary.Width);
        var nativeH = Math.Max(1, _desktopGeom.Primary.Height);

        int envW = (int)ReadUIntEnv("REMOTE_CONSOLE_VIDEO_WIDTH", 0);
        int envH = (int)ReadUIntEnv("REMOTE_CONSOLE_VIDEO_HEIGHT", 0);
        int envFps = (int)ReadUIntEnv("REMOTE_CONSOLE_VIDEO_FPS", 30);

        int envMaxDim = (int)ReadUIntEnv("REMOTE_CONSOLE_VIDEO_MAX_DIM", 3840);
        envMaxDim = Math.Clamp(envMaxDim, 0, 8192);

        int w = envW <= 0 ? nativeW : envW;
        int h = envH <= 0 ? nativeH : envH;
        int fps = Math.Clamp(envFps, 1, 60);

        if (envW <= 0 && envH <= 0 && envMaxDim > 0)
        {
            (w, h) = ScaleToMaxDimPreserveAspect(w, h, envMaxDim);
        }

        if (w % 2 != 0) w--;
        if (h % 2 != 0) h--;

        w = Math.Clamp(w, 64, 7680);
        h = Math.Clamp(h, 64, 4320);
        fps = Math.Clamp(fps, 1, 30);

        int AutoKbps(int ww, int hh, int ff, double bitsPerPixel)
        {
            var bps = bitsPerPixel * ff * (double)ww * (double)hh;
            return (int)Math.Round(bps / 1000.0);
        }

        int envStart = (int)ReadUIntEnv("REMOTE_CONSOLE_VIDEO_START_KBPS", 0);
        int envMax = (int)ReadUIntEnv("REMOTE_CONSOLE_VIDEO_MAX_KBPS", 0);

        _keyframeSeconds = (int)ReadUIntEnv("REMOTE_CONSOLE_VIDEO_KEYFRAME_SECONDS", 1);

        _targetKbps = envStart <= 0 ? AutoKbps(w, h, fps, 0.85) : envStart;
        _maxKbps = envMax <= 0 ? AutoKbps(w, h, fps, 1.40) : envMax;

        _targetKbps = Math.Clamp(_targetKbps, 800, 50_000);
        _maxKbps = Math.Clamp(_maxKbps, _targetKbps, 80_000);

        _keyframeSeconds = Math.Clamp(_keyframeSeconds, 1, 5);

        _desktopGeom = DesktopGeometry.ReadCurrent(isSession0);

        _log.LogInformation(
            "RemoteConsole quality params session={SessionId} native={NativeW}x{NativeH} capture={W}x{H} fps={Fps} startKbps={StartKbps} maxKbps={MaxKbps} keyframeSec={KeyframeSec} maxDim={MaxDim} forcedWH={ForcedWH}",
            SessionId, nativeW, nativeH, w, h, fps, _targetKbps, _maxKbps, _keyframeSeconds, envMaxDim, (envW > 0 || envH > 0)
        );

        _videoEncoder = new VpxVideoEncoder();
        _log.LogInformation("RemoteConsole selected encoder={Encoder} session={SessionId}", _videoEncoder.GetType().FullName, SessionId);

        TryConfigureEncoderBestEffort(_videoEncoder, _targetKbps, _maxKbps, fps, _log, SessionId);

        if (sourcePref == "camera" || sourcePref == "webcam")
        {
            throw new InvalidOperationException("Webcam requested but webcam pipeline is intentionally disabled in this build.");
        }

        _videoSource = isSession0
            ? new HelperPipeDesktopVideoSource(w, h, fps, _videoEncoder, _log, SessionId)
            : new DirectGdiDesktopVideoSource(w, h, fps, _videoEncoder, _log, SessionId);

        if (isSession0)
        {
            _log.LogWarning(
                "RemoteConsole is running in Session 0 (service isolation). Using capture helper in interactive user session. session={SessionId}",
                SessionId
            );
        }

        // ✅ Allow VP9 primary, VP8 fallback.
        // Negotiation will pick the first preferred codec that both sides support.
        // Runtime fallback also exists in the encoder loop (VP9 -> VP8) if VP9 encode fails.
        _videoSource.RestrictFormats(f => f.Codec == VideoCodecsEnum.VP9 || f.Codec == VideoCodecsEnum.VP8);

        _videoTrack = new MediaStreamTrack(_videoSource.GetVideoSourceFormats(), MediaStreamStatusEnum.SendOnly);
        pc.addTrack(_videoTrack);

        _videoSource.OnVideoSourceEncodedSample += pc.SendVideo;
        _videoSource.OnVideoSourceError += (err) =>
        {
            _log.LogError("RemoteConsole desktop capture error session={SessionId} err={Err}", SessionId, err);
        };

        _videoAttached = true;

        _log.LogInformation(
            "RemoteConsole desktop video enabled session={SessionId} sourceType={SourceType} size={W}x{H} fps={Fps} startKbps={StartKbps} maxKbps={MaxKbps} keyframeSec={KeyframeSec}",
            SessionId,
            _videoSource.GetType().FullName,
            w, h, fps,
            _targetKbps, _maxKbps, _keyframeSeconds
        );
    }

    private static (int w, int h) ScaleToMaxDimPreserveAspect(int w, int h, int maxDim)
    {
        if (maxDim <= 0) return (w, h);
        if (w <= maxDim && h <= maxDim) return (w, h);

        double scale = (w >= h) ? ((double)maxDim / w) : ((double)maxDim / h);
        int nw = Math.Max(64, (int)Math.Round(w * scale));
        int nh = Math.Max(64, (int)Math.Round(h * scale));
        return (nw, nh);
    }

    private void StartKeyframeTimer()
    {
        if (_closed) return;
        if (_videoEncoder == null) return;

        StopKeyframeTimer();

        _keyframeTimer = new Timer(_ =>
        {
            try { _videoEncoder?.ForceKeyFrame(); } catch { }
        }, null, TimeSpan.FromSeconds(_keyframeSeconds), TimeSpan.FromSeconds(_keyframeSeconds));
    }

    private void StopKeyframeTimer()
    {
        try { _keyframeTimer?.Dispose(); } catch { }
        _keyframeTimer = null;
    }

    private async Task StartVideoIfReadyAsync()
    {
        if (_closed) return;
        if (_videoSource == null) return;
        if (_videoStarted) return;

        try
        {
            await _videoSource.StartVideo().ConfigureAwait(false);
            _videoStarted = true;
            _log.LogInformation("RemoteConsole desktop video started session={SessionId}", SessionId);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "RemoteConsole failed to start desktop video session={SessionId}", SessionId);
        }
    }

    private async Task StopVideoBestEffortAsync()
    {
        if (_videoSource == null) return;
        if (!_videoStarted) return;

        try { await _videoSource.CloseVideo().ConfigureAwait(false); } catch { }
        _videoStarted = false;
    }

    // ---------------------------------------------------------------------
    // Video sources
    // ---------------------------------------------------------------------

    private sealed class DirectGdiDesktopVideoSource : IVideoSource, IDisposable
    {
        private const int VIDEO_SAMPLING_RATE = 90000;

        // Common dynamic PTs
        private const int VP9_PT = 98;
        private const int VP8_PT = 96;

        // ✅ VP9 first, VP8 second
        private static readonly List<VideoFormat> Formats =
        [
            new VideoFormat(VideoCodecsEnum.VP9, VP9_PT, VIDEO_SAMPLING_RATE),
            new VideoFormat(VideoCodecsEnum.VP8, VP8_PT, VIDEO_SAMPLING_RATE),
        ];

        private readonly int _w;
        private readonly int _h;
        private readonly int _fps;
        private readonly IVideoEncoder _encoder;
        private readonly ILogger _log;
        private readonly string _sessionId;
        private readonly MediaFormatManager<VideoFormat> _fmtMgr;

        private Timer? _timer;
        private volatile bool _started;
        private volatile bool _closed;

        public DirectGdiDesktopVideoSource(int w, int h, int fps, IVideoEncoder encoder, ILogger log, string sessionId)
        {
            _w = w;
            _h = h;
            _fps = Math.Clamp(fps, 1, 30);
            _encoder = encoder;
            _log = log;
            _sessionId = sessionId;

            _fmtMgr = new MediaFormatManager<VideoFormat>(Formats);
            _fmtMgr.SetSelectedFormat(Formats[0]);

            _timer = new Timer(Tick, null, Timeout.Infinite, Timeout.Infinite);
        }

        public event RawVideoSampleDelegate? OnVideoSourceRawSample;
#pragma warning disable CS0067
        public event RawVideoSampleFasterDelegate? OnVideoSourceRawSampleFaster;
#pragma warning restore CS0067
        public event EncodedSampleDelegate? OnVideoSourceEncodedSample;
        public event SourceErrorDelegate? OnVideoSourceError;

        public void RestrictFormats(Func<VideoFormat, bool> filter) => _fmtMgr.RestrictFormats(filter);

        public List<VideoFormat> GetVideoSourceFormats() => _fmtMgr.GetSourceFormats();
        public void SetVideoSourceFormat(VideoFormat videoFormat) => _fmtMgr.SetSelectedFormat(videoFormat);

        public List<VideoFormat> GetVideoSinkFormats() => _fmtMgr.GetSourceFormats();
        public void SetVideoSinkFormat(VideoFormat videoFormat) => _fmtMgr.SetSelectedFormat(videoFormat);

        public void ForceKeyFrame() => _encoder.ForceKeyFrame();
        public bool HasEncodedVideoSubscribers() => OnVideoSourceEncodedSample != null;
        public Task<bool> InitialiseVideoSourceDevice() => Task.FromResult(true);
        public bool IsVideoSourcePaused() => false;

        public Task PauseVideo() => Task.CompletedTask;
        public Task ResumeVideo() => Task.CompletedTask;

        public Task StartVideo()
        {
            if (_closed) return Task.CompletedTask;
            if (_started) return Task.CompletedTask;

            _started = true;
            _timer?.Change(0, FrameMs);
            return Task.CompletedTask;
        }

        public Task CloseVideo()
        {
            if (_closed) return Task.CompletedTask;
            _closed = true;

            try { _timer?.Change(Timeout.Infinite, Timeout.Infinite); } catch { }
            try { _timer?.Dispose(); } catch { }
            _timer = null;

            return Task.CompletedTask;
        }

        public void Dispose() => _ = CloseVideo();

        public void ExternalVideoSourceRawSample(uint durationMilliseconds, int width, int height, byte[] sample, VideoPixelFormatsEnum pixelFormat)
            => throw new NotImplementedException();

        public void ExternalVideoSourceRawSampleFaster(uint durationMilliseconds, RawImage rawImage)
            => throw new NotImplementedException();

        private int FrameMs => (int)Math.Round(1000.0 / _fps);

        private void Tick(object? _)
        {
            if (_closed || !_started) return;
            if (OnVideoSourceEncodedSample == null && OnVideoSourceRawSample == null) return;

            try
            {
                var bgra = Gdi.CapturePrimaryScreenBgraScaled(_w, _h, out var err);
                if (bgra == null)
                {
                    OnVideoSourceError?.Invoke($"Direct capture failed: {err}");
                    return;
                }

                OnVideoSourceRawSample?.Invoke((uint)FrameMs, _w, _h, bgra, VideoPixelFormatsEnum.Bgra);

                if (OnVideoSourceEncodedSample != null && !_fmtMgr.SelectedFormat.IsEmpty())
                {
                    var encoded = EncodeWithVp9PrimaryVp8Fallback(_encoder, _w, _h, bgra, VideoPixelFormatsEnum.Bgra, _fmtMgr, _log, _sessionId);
                    if (encoded != null && encoded.Length > 0)
                    {
                        uint durationRtpTs = (uint)(VIDEO_SAMPLING_RATE / Math.Max(1, _fps));
                        OnVideoSourceEncodedSample.Invoke(durationRtpTs, encoded);
                    }
                }
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "RemoteConsole direct capture tick error session={SessionId}", _sessionId);
                OnVideoSourceError?.Invoke(ex.Message);
            }
        }
    }

    private sealed class HelperPipeDesktopVideoSource : IVideoSource, IDisposable
    {
        private const int VIDEO_SAMPLING_RATE = 90000;

        private const int VP9_PT = 98;
        private const int VP8_PT = 96;

        // ✅ VP9 first, VP8 second
        private static readonly List<VideoFormat> Formats =
        [
            new VideoFormat(VideoCodecsEnum.VP9, VP9_PT, VIDEO_SAMPLING_RATE),
            new VideoFormat(VideoCodecsEnum.VP8, VP8_PT, VIDEO_SAMPLING_RATE),
        ];

        private readonly int _w;
        private readonly int _h;
        private readonly int _fps;
        private readonly IVideoEncoder _encoder;
        private readonly ILogger _log;
        private readonly string _sessionId;

        private readonly MediaFormatManager<VideoFormat> _fmtMgr;

        private CancellationTokenSource? _cts;
        private Task? _loop;

        private volatile bool _started;
        private volatile bool _closed;

        public HelperPipeDesktopVideoSource(int w, int h, int fps, IVideoEncoder encoder, ILogger log, string sessionId)
        {
            _w = w;
            _h = h;
            _fps = Math.Clamp(fps, 1, 30);
            _encoder = encoder;
            _log = log;
            _sessionId = sessionId;

            _fmtMgr = new MediaFormatManager<VideoFormat>(Formats);
            _fmtMgr.SetSelectedFormat(Formats[0]);
        }

        public event RawVideoSampleDelegate? OnVideoSourceRawSample;
#pragma warning disable CS0067
        public event RawVideoSampleFasterDelegate? OnVideoSourceRawSampleFaster;
#pragma warning restore CS0067
        public event EncodedSampleDelegate? OnVideoSourceEncodedSample;
        public event SourceErrorDelegate? OnVideoSourceError;

        public void RestrictFormats(Func<VideoFormat, bool> filter) => _fmtMgr.RestrictFormats(filter);

        public List<VideoFormat> GetVideoSourceFormats() => _fmtMgr.GetSourceFormats();
        public void SetVideoSourceFormat(VideoFormat videoFormat) => _fmtMgr.SetSelectedFormat(videoFormat);

        public List<VideoFormat> GetVideoSinkFormats() => _fmtMgr.GetSourceFormats();
        public void SetVideoSinkFormat(VideoFormat videoFormat) => _fmtMgr.SetSelectedFormat(videoFormat);

        public void ForceKeyFrame() => _encoder.ForceKeyFrame();
        public bool HasEncodedVideoSubscribers() => OnVideoSourceEncodedSample != null;
        public Task<bool> InitialiseVideoSourceDevice() => Task.FromResult(true);
        public bool IsVideoSourcePaused() => false;

        public Task PauseVideo() => Task.CompletedTask;
        public Task ResumeVideo() => Task.CompletedTask;

        public Task StartVideo()
        {
            if (_closed) return Task.CompletedTask;
            if (_started) return Task.CompletedTask;

            _started = true;

            _cts = new CancellationTokenSource();
            _loop = Task.Run(() => RunLoop(_cts.Token));

            return Task.CompletedTask;
        }

        public async Task CloseVideo()
        {
            if (_closed) return;
            _closed = true;

            try { _cts?.Cancel(); } catch { }

            try
            {
                if (_loop != null) await _loop.ConfigureAwait(false);
            }
            catch { }

            _cts?.Dispose();
            _cts = null;
            _loop = null;
        }

        public void Dispose() => _ = CloseVideo();

        public void ExternalVideoSourceRawSample(uint durationMilliseconds, int width, int height, byte[] sample, VideoPixelFormatsEnum pixelFormat)
            => throw new NotImplementedException();

        public void ExternalVideoSourceRawSampleFaster(uint durationMilliseconds, RawImage rawImage)
            => throw new NotImplementedException();

        private async Task RunLoop(CancellationToken ct)
        {
            var pipeName = $"RemoteIQ.RemoteConsole.{_sessionId}";
            var secret = GenerateSecret();

            try
            {
                using var pipe = new NamedPipeServerStream(
                    pipeName: pipeName,
                    direction: PipeDirection.In,
                    maxNumberOfServerInstances: 1,
                    transmissionMode: PipeTransmissionMode.Byte,
                    options: PipeOptions.Asynchronous,
                    inBufferSize: 1024 * 1024,
                    outBufferSize: 0);

                CaptureHelperTask.EnsureAndRun(pipeName, secret, _w, _h, _fps, _log, _sessionId);

                var connectTimeoutMs = 25000;
                using var connectCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                connectCts.CancelAfter(connectTimeoutMs);

                await pipe.WaitForConnectionAsync(connectCts.Token).ConfigureAwait(false);

                using var br = new BinaryReader(pipe, Encoding.UTF8, leaveOpen: true);

                var m1 = br.ReadByte();
                var m2 = br.ReadByte();
                var m3 = br.ReadByte();
                var m4 = br.ReadByte();
                if (m1 != (byte)'R' || m2 != (byte)'I' || m3 != (byte)'Q' || m4 != (byte)'1')
                    throw new InvalidOperationException("Bad pipe magic.");

                var ver = br.ReadInt32();
                if (ver != 1) throw new InvalidOperationException($"Unsupported pipe protocol version {ver}.");

                var secretLen = br.ReadInt32();
                if (secretLen <= 0 || secretLen > 4096) throw new InvalidOperationException("Invalid secret length.");
                var secretBytes = br.ReadBytes(secretLen);
                var gotSecret = Encoding.UTF8.GetString(secretBytes);

                if (!FixedTimeEquals(secret, gotSecret))
                    throw new UnauthorizedAccessException("Pipe secret mismatch.");

                _log.LogInformation(
                    "RemoteConsole capture helper connected and authenticated session={SessionId} pipe={Pipe} size={W}x{H} fps={Fps}",
                    _sessionId, pipeName, _w, _h, _fps
                );

                while (!ct.IsCancellationRequested && pipe.IsConnected)
                {
                    var fw = br.ReadInt32();
                    var fh = br.ReadInt32();
                    var pf = br.ReadInt32();
                    var len = br.ReadInt32();

                    if (pf != 1) throw new InvalidOperationException($"Unsupported pixel format {pf}.");
                    if (fw != _w || fh != _h) throw new InvalidOperationException($"Unexpected frame size {fw}x{fh} (expected {_w}x{_h}).");
                    if (len <= 0 || len > (_w * _h * 4)) throw new InvalidOperationException("Bad frame length.");

                    var data = br.ReadBytes(len);
                    if (data.Length != len) throw new EndOfStreamException("Pipe frame truncated.");

                    OnVideoSourceRawSample?.Invoke((uint)(1000 / Math.Max(1, _fps)), _w, _h, data, VideoPixelFormatsEnum.Bgra);

                    if (OnVideoSourceEncodedSample != null && !_fmtMgr.SelectedFormat.IsEmpty())
                    {
                        var encoded = EncodeWithVp9PrimaryVp8Fallback(_encoder, _w, _h, data, VideoPixelFormatsEnum.Bgra, _fmtMgr, _log, _sessionId);
                        if (encoded != null && encoded.Length > 0)
                        {
                            uint durationRtpTs = (uint)(VIDEO_SAMPLING_RATE / Math.Max(1, _fps));
                            OnVideoSourceEncodedSample.Invoke(durationRtpTs, encoded);
                        }
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // expected
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "RemoteConsole helper pipe capture loop failed session={SessionId}", _sessionId);
                OnVideoSourceError?.Invoke(ex.Message);
            }
        }

        private static string GenerateSecret()
        {
            Span<byte> b = stackalloc byte[32];
            RandomNumberGenerator.Fill(b);
            return Convert.ToBase64String(b);
        }

        private static bool FixedTimeEquals(string a, string b)
        {
            var ab = Encoding.UTF8.GetBytes(a);
            var bb = Encoding.UTF8.GetBytes(b);
            return CryptographicOperations.FixedTimeEquals(ab, bb);
        }
    }

    private static byte[]? EncodeWithVp9PrimaryVp8Fallback(
        IVideoEncoder encoder,
        int w,
        int h,
        byte[] bgra,
        VideoPixelFormatsEnum px,
        MediaFormatManager<VideoFormat> fmtMgr,
        ILogger log,
        string sessionId)
    {
        var fmt = fmtMgr.SelectedFormat;
        if (fmt.IsEmpty()) return null;

        // Try selected codec first
        try
        {
            var enc = encoder.EncodeVideo(w, h, bgra, px, fmt.Codec);
            if (enc != null && enc.Length > 0) return enc;
        }
        catch (Exception ex)
        {
            // If VP9 fails, drop to VP8
            if (fmt.Codec == VideoCodecsEnum.VP9)
            {
                log.LogWarning(ex, "RemoteConsole VP9 encode failed; falling back to VP8. session={SessionId}", sessionId);
            }
            else
            {
                log.LogDebug(ex, "RemoteConsole encode failed codec={Codec} session={SessionId}", fmt.Codec, sessionId);
                return null;
            }
        }

        // Fallback: if current is VP9, switch to VP8 and try once
        if (fmt.Codec == VideoCodecsEnum.VP9)
        {
            try
            {
                var vp8 = fmtMgr.GetSourceFormats().FirstOrDefault(f => f.Codec == VideoCodecsEnum.VP8);
                if (!vp8.IsEmpty())
                {
                    fmtMgr.SetSelectedFormat(vp8);
                    log.LogInformation("RemoteConsole switched selected codec to VP8 (fallback) session={SessionId}", sessionId);

                    var enc2 = encoder.EncodeVideo(w, h, bgra, px, vp8.Codec);
                    if (enc2 != null && enc2.Length > 0) return enc2;
                }
            }
            catch (Exception ex2)
            {
                log.LogWarning(ex2, "RemoteConsole VP8 fallback encode failed session={SessionId}", sessionId);
            }
        }

        return null;
    }

    // ---------------------------------------------------------------------
    // Task Scheduler COM launcher (InteractiveToken) - needs REAL userId
    // ---------------------------------------------------------------------

    private static class CaptureHelperTask
    {
        public static void EnsureAndRun(string pipeName, string secret, int w, int h, int fps, ILogger log, string sessionId)
        {
            var helperExe = ResolveHelperPath();
            if (string.IsNullOrWhiteSpace(helperExe) || !File.Exists(helperExe))
                throw new FileNotFoundException($"Capture helper not found at '{helperExe}'. Ensure it is deployed next to the agent service.");

            var user = InteractiveUserProbe.GetInteractiveUser();
            log.LogInformation("RemoteConsole capture helper target interactive user session={SessionId} user='{User}'", sessionId, user ?? "(null)");

            if (string.IsNullOrWhiteSpace(user))
                throw new InvalidOperationException("No interactive user detected (required for InteractiveToken task). A user must be logged in at the console.");

            var taskName = $"RemoteIQ.RemoteConsole.Capture.{sessionId}";
            var args = $"--pipe {pipeName} --secret {secret} --w {w} --h {h} --fps {fps}";

            var workDir = Path.GetDirectoryName(helperExe) ?? AppContext.BaseDirectory;

            TaskSchedulerCom.CreateOrUpdateAndRunInteractiveTask(
                taskName: taskName,
                exePath: helperExe,
                arguments: args,
                workingDirectory: workDir,
                description: "RemoteIQ Remote Console desktop capture helper",
                userId: user,
                log: log,
                sessionId: sessionId
            );
        }

        private static string ResolveHelperPath()
        {
            var p1 = Path.Combine(AppContext.BaseDirectory, "tools", "capture-helper", "RemoteIQ.CaptureHelper.exe");
            if (File.Exists(p1)) return p1;

            var p2 = Path.Combine(AppContext.BaseDirectory, "RemoteIQ.CaptureHelper.exe");
            if (File.Exists(p2)) return p2;

            return p1;
        }
    }

    private static class TaskSchedulerCom
    {
        private const int TASK_TRIGGER_TIME = 1;
        private const int TASK_ACTION_EXEC = 0;
        private const int TASK_CREATE_OR_UPDATE = 6;

        private const int TASK_LOGON_INTERACTIVE_TOKEN = 3;
        private const int TASK_RUNLEVEL_HIGHEST = 1;

        public static void CreateOrUpdateAndRunInteractiveTask(
            string taskName,
            string exePath,
            string arguments,
            string workingDirectory,
            string description,
            string userId,
            ILogger log,
            string sessionId)
        {
            var svcType = Type.GetTypeFromProgID("Schedule.Service")
                ?? throw new InvalidOperationException("Task Scheduler COM (Schedule.Service) not available.");

            dynamic service = Activator.CreateInstance(svcType)
                ?? throw new InvalidOperationException("Failed to create Schedule.Service COM instance.");

            service.Connect();
            dynamic root = service.GetFolder("\\");

            try { root.DeleteTask(taskName, 0); } catch { }

            dynamic def = service.NewTask(0);

            def.RegistrationInfo.Description = description;

            def.Principal.UserId = userId;
            def.Principal.LogonType = TASK_LOGON_INTERACTIVE_TOKEN;
            def.Principal.RunLevel = TASK_RUNLEVEL_HIGHEST;

            def.Settings.Enabled = true;
            def.Settings.Hidden = true;
            def.Settings.AllowDemandStart = true;
            def.Settings.DisallowStartIfOnBatteries = false;
            def.Settings.StopIfGoingOnBatteries = false;
            def.Settings.ExecutionTimeLimit = "PT0S";
            def.Settings.MultipleInstances = 0; // IgnoreNew

            dynamic triggers = def.Triggers;
            dynamic trigger = triggers.Create(TASK_TRIGGER_TIME);
            var start = DateTime.Now.AddSeconds(30);
            trigger.StartBoundary = start.ToString("yyyy-MM-dd'T'HH:mm:ss");

            dynamic actions = def.Actions;
            dynamic action = actions.Create(TASK_ACTION_EXEC);
            action.Path = exePath;
            action.Arguments = arguments;
            action.WorkingDirectory = workingDirectory;

            log.LogInformation(
                "RemoteConsole registering task session={SessionId} task='{Task}' userId='{UserId}' exe='{Exe}' args='{Args}' wd='{Wd}'",
                sessionId, taskName, userId, exePath, arguments, workingDirectory
            );

            dynamic registered = root.RegisterTaskDefinition(
                taskName,
                def,
                TASK_CREATE_OR_UPDATE,
                userId,
                null,
                TASK_LOGON_INTERACTIVE_TOKEN,
                null
            );

            log.LogInformation(
                "RemoteConsole task registered session={SessionId} task='{Task}'",
                sessionId, taskName
            );

            dynamic running = registered.Run(null);

            try
            {
                var state = (int)running.State;
                log.LogInformation("RemoteConsole task started session={SessionId} task='{Task}' state={State}", sessionId, taskName, state);
            }
            catch
            {
                log.LogInformation("RemoteConsole task started session={SessionId} task='{Task}'", sessionId, taskName);
            }
        }
    }

    private static class InteractiveUserProbe
    {
        public static string? GetInteractiveUser()
        {
            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT UserName FROM Win32_ComputerSystem");
                foreach (var o in searcher.Get())
                {
                    if (o is ManagementObject mo)
                    {
                        var user = (mo["UserName"] as string ?? "").Trim();
                        if (!string.IsNullOrWhiteSpace(user))
                            return user;
                    }
                }
            }
            catch { }

            try
            {
                var sessionId = WTSGetActiveConsoleSessionId();
                if (sessionId == 0xFFFFFFFF) return null;

                if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, WTS_INFO_CLASS.WTSUserName, out var pUser, out var _))
                    return null;

                if (!WTSQuerySessionInformation(IntPtr.Zero, sessionId, WTS_INFO_CLASS.WTSDomainName, out var pDomain, out var _2))
                {
                    WTSFreeMemory(pUser);
                    return null;
                }

                var user = PtrToString(pUser);
                var domain = PtrToString(pDomain);

                WTSFreeMemory(pUser);
                WTSFreeMemory(pDomain);

                if (string.IsNullOrWhiteSpace(user)) return null;
                if (string.IsNullOrWhiteSpace(domain)) return user;
                return $"{domain}\\{user}";
            }
            catch
            {
                return null;
            }
        }

        private static string PtrToString(IntPtr p)
        {
            if (p == IntPtr.Zero) return "";
            return Marshal.PtrToStringUni(p) ?? "";
        }

        private enum WTS_INFO_CLASS
        {
            WTSUserName = 5,
            WTSDomainName = 7
        }

        [DllImport("kernel32.dll")]
        private static extern uint WTSGetActiveConsoleSessionId();

        [DllImport("wtsapi32.dll", SetLastError = true)]
        private static extern bool WTSQuerySessionInformation(
            IntPtr hServer,
            uint sessionId,
            WTS_INFO_CLASS wtsInfoClass,
            out IntPtr ppBuffer,
            out uint pBytesReturned);

        [DllImport("wtsapi32.dll")]
        private static extern void WTSFreeMemory(IntPtr pMemory);
    }

    // ---------------------------------------------------------------------
    // GDI capture helpers (only used when NOT session0)
    // ---------------------------------------------------------------------

    private static class Gdi
    {
        public static byte[]? CapturePrimaryScreenBgraScaled(int targetW, int targetH, out string error)
        {
            error = "";
            try
            {
                var primary = DesktopGeometry.ReadCurrent(false).Primary;
                var srcW = Math.Max(1, primary.Width);
                var srcH = Math.Max(1, primary.Height);

                var native = DirectScreen.CaptureVirtualRectBgra(primary.Left, primary.Top, srcW, srcH);
                if (srcW == targetW && srcH == targetH) return native;
                return ImageScale.ScaleBgraBilinear(native, srcW, srcH, targetW, targetH);
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return null;
            }
        }
    }

    private static class ImageScale
    {
        public static byte[] ScaleBgraBilinear(byte[] src, int srcW, int srcH, int dstW, int dstH)
        {
            var dst = new byte[dstW * dstH * 4];
            ScaleBgraBilinearInto(src, srcW, srcH, dst, dstW, dstH);
            return dst;
        }

        public static void ScaleBgraBilinearInto(byte[] src, int srcW, int srcH, byte[] dst, int dstW, int dstH)
        {
            if (dst.Length < dstW * dstH * 4) throw new ArgumentException("dst too small");

            double xScale = (double)(srcW - 1) / Math.Max(1, dstW - 1);
            double yScale = (double)(srcH - 1) / Math.Max(1, dstH - 1);

            for (int y = 0; y < dstH; y++)
            {
                double sy = y * yScale;
                int y0 = (int)sy;
                int y1 = Math.Min(y0 + 1, srcH - 1);
                double fy = sy - y0;

                int dstRow = y * dstW * 4;
                int srcRow0 = y0 * srcW * 4;
                int srcRow1 = y1 * srcW * 4;

                for (int x = 0; x < dstW; x++)
                {
                    double sx = x * xScale;
                    int x0 = (int)sx;
                    int x1 = Math.Min(x0 + 1, srcW - 1);
                    double fx = sx - x0;

                    int i00 = srcRow0 + x0 * 4;
                    int i10 = srcRow0 + x1 * 4;
                    int i01 = srcRow1 + x0 * 4;
                    int i11 = srcRow1 + x1 * 4;

                    int d = dstRow + x * 4;

                    for (int c = 0; c < 4; c++)
                    {
                        double p00 = src[i00 + c];
                        double p10 = src[i10 + c];
                        double p01 = src[i01 + c];
                        double p11 = src[i11 + c];

                        double a = p00 + (p10 - p00) * fx;
                        double b = p01 + (p11 - p01) * fx;
                        double v = a + (b - a) * fy;

                        dst[d + c] = (byte)Math.Clamp((int)Math.Round(v), 0, 255);
                    }
                }
            }
        }
    }

    private static class DirectScreen
    {
        private const int SRCCOPY = 0x00CC0020;
        private const int CAPTUREBLT = 0x40000000;
        private const uint BI_RGB = 0;
        private const uint DIB_RGB_COLORS = 0;

        public static byte[] CaptureVirtualRectBgra(int x, int y, int w, int h)
        {
            IntPtr hDesk = GetDesktopWindow();
            IntPtr hSrcDc = GetWindowDC(hDesk);
            if (hSrcDc == IntPtr.Zero)
                throw new InvalidOperationException("GetWindowDC returned NULL.");

            IntPtr hMemDc = IntPtr.Zero;
            IntPtr hBmp = IntPtr.Zero;
            IntPtr hOld = IntPtr.Zero;

            try
            {
                hMemDc = CreateCompatibleDC(hSrcDc);
                if (hMemDc == IntPtr.Zero) throw new InvalidOperationException("CreateCompatibleDC returned NULL.");

                var bmi = new BITMAPINFO();
                bmi.bmiHeader.biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>();
                bmi.bmiHeader.biWidth = w;
                bmi.bmiHeader.biHeight = -h;
                bmi.bmiHeader.biPlanes = 1;
                bmi.bmiHeader.biBitCount = 32;
                bmi.bmiHeader.biCompression = BI_RGB;

                IntPtr ppvBits;
                hBmp = CreateDIBSection(hSrcDc, ref bmi, DIB_RGB_COLORS, out ppvBits, IntPtr.Zero, 0);
                if (hBmp == IntPtr.Zero || ppvBits == IntPtr.Zero)
                    throw new InvalidOperationException("CreateDIBSection failed.");

                hOld = SelectObject(hMemDc, hBmp);
                if (hOld == IntPtr.Zero) throw new InvalidOperationException("SelectObject failed.");

                bool ok = BitBlt(hMemDc, 0, 0, w, h, hSrcDc, x, y, SRCCOPY | CAPTUREBLT);
                if (!ok)
                {
                    var err = Marshal.GetLastWin32Error();
                    throw new InvalidOperationException($"BitBlt failed. GetLastError={err} (0x{err:X8}).");
                }

                int bytes = w * h * 4;
                byte[] buffer = new byte[bytes];
                Marshal.Copy(ppvBits, buffer, 0, bytes);
                return buffer;
            }
            finally
            {
                if (hOld != IntPtr.Zero && hMemDc != IntPtr.Zero) SelectObject(hMemDc, hOld);
                if (hBmp != IntPtr.Zero) DeleteObject(hBmp);
                if (hMemDc != IntPtr.Zero) DeleteDC(hMemDc);
                if (hSrcDc != IntPtr.Zero) ReleaseDC(hDesk, hSrcDc);
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BITMAPINFO
        {
            public BITMAPINFOHEADER bmiHeader;
            public uint bmiColors;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BITMAPINFOHEADER
        {
            public uint biSize;
            public int biWidth;
            public int biHeight;
            public ushort biPlanes;
            public ushort biBitCount;
            public uint biCompression;
            public uint biSizeImage;
            public int biXPelsPerMeter;
            public uint biYPelsPerMeter;
            public uint biClrUsed;
            public uint biClrImportant;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr GetDesktopWindow();

        [DllImport("user32.dll")]
        private static extern IntPtr GetWindowDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        private static extern IntPtr SelectObject(IntPtr hdc, IntPtr h);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern bool DeleteObject(IntPtr ho);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern IntPtr CreateDIBSection(
            IntPtr hdc,
            [In] ref BITMAPINFO pbmi,
            uint iUsage,
            out IntPtr ppvBits,
            IntPtr hSection,
            uint dwOffset);

        [DllImport("gdi32.dll", SetLastError = true)]
        private static extern bool BitBlt(
            IntPtr hdcDest,
            int xDest,
            int yDest,
            int wDest,
            int hDest,
            IntPtr hdcSrc,
            int xSrc,
            int ySrc,
            int rop);
    }

    private static uint ReadUIntEnv(string name, uint fallback)
    {
        var raw = (Environment.GetEnvironmentVariable(name) ?? "").Trim();
        if (uint.TryParse(raw, out var v) && v > 0) return v;
        return fallback;
    }

    // ---------------------------------------------------------------------
    // SDP utilities (Prefer VP9 primary, VP8 fallback + set bitrate hints)
    // ---------------------------------------------------------------------

    private static class SdpUtil
    {
        public static string PreferVp9Vp8AndSetBitrateHints(string sdp, int startKbps, int maxKbps)
        {
            if (string.IsNullOrWhiteSpace(sdp)) return sdp;

            var lines = sdp.Replace("\r\n", "\n").Split('\n').Select(l => l.TrimEnd()).ToList();
            int videoM = lines.FindIndex(l => l.StartsWith("m=video ", StringComparison.OrdinalIgnoreCase));
            if (videoM < 0) return sdp;

            var vp9Pts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var vp8Pts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            for (int i = 0; i < lines.Count; i++)
            {
                var l = lines[i];
                if (!l.StartsWith("a=rtpmap:", StringComparison.OrdinalIgnoreCase)) continue;

                var rest = l.Substring("a=rtpmap:".Length);
                var sp = rest.IndexOf(' ');
                if (sp <= 0) continue;
                var pt = rest.Substring(0, sp).Trim();
                var codec = rest.Substring(sp + 1).Trim();

                if (codec.StartsWith("VP9/", StringComparison.OrdinalIgnoreCase)) vp9Pts.Add(pt);
                if (codec.StartsWith("VP8/", StringComparison.OrdinalIgnoreCase)) vp8Pts.Add(pt);
            }

            // Prefer VP9 first, then VP8
            if (vp9Pts.Count > 0 || vp8Pts.Count > 0)
            {
                var m = lines[videoM];
                var parts = m.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 4)
                {
                    var header = parts.Take(3).ToList();
                    var pts = parts.Skip(3).ToList();

                    string? firstVp9 = pts.FirstOrDefault(p => vp9Pts.Contains(p));
                    string? firstVp8 = pts.FirstOrDefault(p => vp8Pts.Contains(p));

                    // Move VP9 to front if present; else move VP8 to front.
                    if (!string.IsNullOrWhiteSpace(firstVp9))
                    {
                        pts.Remove(firstVp9);
                        pts.Insert(0, firstVp9);
                    }
                    else if (!string.IsNullOrWhiteSpace(firstVp8))
                    {
                        pts.Remove(firstVp8);
                        pts.Insert(0, firstVp8);
                    }

                    lines[videoM] = string.Join(' ', header.Concat(pts));
                }
            }

            int insertAt = videoM + 1;
            while (insertAt < lines.Count &&
                   (lines[insertAt].StartsWith("i=", StringComparison.OrdinalIgnoreCase) ||
                    lines[insertAt].StartsWith("c=", StringComparison.OrdinalIgnoreCase)))
            {
                insertAt++;
            }

            int end = FindSectionEnd(lines, videoM);

            // remove existing b=AS/b=TIAS in video section
            for (int i = end - 1; i > videoM; i--)
            {
                if (lines[i].StartsWith("b=AS:", StringComparison.OrdinalIgnoreCase) ||
                    lines[i].StartsWith("b=TIAS:", StringComparison.OrdinalIgnoreCase))
                {
                    lines.RemoveAt(i);
                    end--;
                }
            }

            var max = Math.Clamp(maxKbps, 300, 300_000);

            lines.Insert(insertAt++, $"b=AS:{max}");
            lines.Insert(insertAt++, $"b=TIAS:{max * 1000}");
            lines.Insert(insertAt++, "a=content:screen");

            // Add bitrate hints for both VP9 and VP8 if present
            var min = 12000;
            foreach (var pt in vp9Pts.Concat(vp8Pts))
            {
                lines.Insert(insertAt++, $"a=fmtp:{pt} x-google-min-bitrate={min};x-google-start-bitrate={min};x-google-max-bitrate={max};x-google-denoise=false;x-google-conference=true;googCpuOveruseDetection=false;googNoiseReduction=false;googHighStartBitrate=true");
            }

            return string.Join("\r\n", lines.Where(l => l.Length > 0)) + "\r\n";
        }

        private static int FindSectionEnd(List<string> lines, int sectionStart)
        {
            for (int i = sectionStart + 1; i < lines.Count; i++)
            {
                if (lines[i].StartsWith("m=", StringComparison.OrdinalIgnoreCase))
                    return i;
            }
            return lines.Count;
        }
    }

    // ---------------------------------------------------------------------
    // Desktop geometry (virtual screen + primary monitor in virtual coords)
    // ---------------------------------------------------------------------

    private readonly struct DesktopGeometry
    {
        public readonly Rect Primary;
        public readonly Rect Virtual;
        public readonly bool IsUnknown;

        public DesktopGeometry(Rect primary, Rect virt, bool unknown = false)
        {
            Primary = primary;
            Virtual = virt;
            IsUnknown = unknown;
        }

        public static DesktopGeometry Unknown => new(new Rect(0, 0, 0, 0), new Rect(0, 0, 0, 0), unknown: true);

        public static DesktopGeometry ReadCurrent(bool isSession0)
        {
            try
            {
                int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
                int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
                int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
                int vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);

                var virt = new Rect(vx, vy, Math.Max(1, vw), Math.Max(1, vh));

                Rect primary = isSession0 ? ProbeWmiHighestResolution() : MonitorUtil.GetPrimaryMonitorRect();

                if (primary.Width <= 0 || primary.Height <= 0)
                {
                    int pw = GetSystemMetrics(SM_CXSCREEN);
                    int ph = GetSystemMetrics(SM_CYSCREEN);
                    primary = new Rect(0, 0, Math.Max(1, pw), Math.Max(1, ph));
                }

                return new DesktopGeometry(primary, virt, unknown: false);
            }
            catch
            {
                return Unknown;
            }
        }

        private static Rect ProbeWmiHighestResolution()
        {
            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT CurrentHorizontalResolution, CurrentVerticalResolution FROM Win32_VideoController WHERE CurrentHorizontalResolution IS NOT NULL");
                int bestW = 0;
                int bestH = 0;
                foreach (var o in searcher.Get())
                {
                    var w = Convert.ToInt32(o["CurrentHorizontalResolution"]);
                    var h = Convert.ToInt32(o["CurrentVerticalResolution"]);
                    if (w > bestW) { bestW = w; bestH = h; }
                }
                if (bestW > 0) return new Rect(0, 0, bestW, bestH);
            }
            catch { }
            return new Rect(0, 0, 0, 0);
        }

        private const int SM_CXSCREEN = 0;
        private const int SM_CYSCREEN = 1;
        private const int SM_XVIRTUALSCREEN = 76;
        private const int SM_YVIRTUALSCREEN = 77;
        private const int SM_CXVIRTUALSCREEN = 78;
        private const int SM_CYVIRTUALSCREEN = 79;

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);
    }

    private readonly struct Rect
    {
        public readonly int Left;
        public readonly int Top;
        public readonly int Width;
        public readonly int Height;

        public Rect(int left, int top, int width, int height)
        {
            Left = left;
            Top = top;
            Width = width;
            Height = height;
        }

        public int Right => Left + Width;
        public int Bottom => Top + Height;

        public override string ToString() => $"[{Left},{Top} {Width}x{Height}]";
    }

    private static class MonitorUtil
    {
        public static Rect GetPrimaryMonitorRect()
        {
            Rect primary = new Rect(0, 0, 0, 0);

            IntPtr hPrimary = MonitorFromPoint(new POINT { x = 0, y = 0 }, MONITOR_DEFAULTTOPRIMARY);
            if (hPrimary == IntPtr.Zero) return primary;

            var mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf<MONITORINFO>();
            if (!GetMonitorInfo(hPrimary, ref mi)) return primary;

            var rc = mi.rcMonitor;
            int w = rc.right - rc.left;
            int h = rc.bottom - rc.top;
            return new Rect(rc.left, rc.top, w, h);
        }

        private const uint MONITOR_DEFAULTTOPRIMARY = 1;

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int x; public int y; }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int left, top, right, bottom; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
    }

    // ---------------------------------------------------------------------
    // DPI helper
    // ---------------------------------------------------------------------

    private static class DpiUtil
    {
        public static void TryEnablePerMonitorV2()
        {
            try
            {
                SetProcessDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2
            }
            catch { }
        }

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiFlag);
    }

    // ---------------------------------------------------------------------
    // Input injection helpers
    // ---------------------------------------------------------------------

    private enum MouseButton { Left, Right, Middle }

    private sealed class RemoteInputInjector
    {
        private bool _altDown, _ctrlDown, _shiftDown, _metaDown;

        public void ReleaseAll()
        {
            if (_shiftDown) Key(VK_SHIFT, false);
            if (_ctrlDown) Key(VK_CONTROL, false);
            if (_altDown) Key(VK_MENU, false);
            if (_metaDown) Key(VK_LWIN, false);

            _altDown = _ctrlDown = _shiftDown = _metaDown = false;
        }

        public void SyncModifiers(bool alt, bool ctrl, bool shift, bool meta)
        {
            if (alt != _altDown) { Key(VK_MENU, alt); _altDown = alt; }
            if (ctrl != _ctrlDown) { Key(VK_CONTROL, ctrl); _ctrlDown = ctrl; }
            if (shift != _shiftDown) { Key(VK_SHIFT, shift); _shiftDown = shift; }
            if (meta != _metaDown) { Key(VK_LWIN, meta); _metaDown = meta; }
        }

        public void SetCursorPos(int x, int y)
        {
            try { SetCursorPosNative(x, y); } catch { }
        }

        public void MouseBtn(bool down, MouseButton button)
        {
            uint flag = 0;
            if (button == MouseButton.Left) flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
            else if (button == MouseButton.Right) flag = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
            else if (button == MouseButton.Middle) flag = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;

            SendMouse(flag, 0);
        }

        public void MouseWheelVertical(int delta)
        {
            int w = Math.Clamp(delta, -120, 120);
            SendMouse(MOUSEEVENTF_WHEEL, w);
        }

        public void MouseWheelHorizontal(int delta)
        {
            int w = Math.Clamp(delta, -120, 120);
            SendMouse(MOUSEEVENTF_HWHEEL, w);
        }

        public void Key(ushort vk, bool down)
        {
            SendKey(vk, down);
        }

        private static void SendMouse(uint flags, int mouseData)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0] = new INPUT
            {
                type = INPUT_MOUSE,
                U = new InputUnion
                {
                    mi = new MOUSEINPUT
                    {
                        dx = 0,
                        dy = 0,
                        mouseData = (uint)mouseData,
                        dwFlags = flags,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };
            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        }

        private static void SendKey(ushort vk, bool down)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0] = new INPUT
            {
                type = INPUT_KEYBOARD,
                U = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = vk,
                        wScan = 0,
                        dwFlags = down ? 0u : KEYEVENTF_KEYUP,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };
            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        }

        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_MENU = 0x12;
        private const ushort VK_LWIN = 0x5B;

        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;

        private const uint KEYEVENTF_KEYUP = 0x0002;

        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_HWHEEL = 0x01000;

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public InputUnion U;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;

            [FieldOffset(0)]
            public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll")]
        private static extern bool SetCursorPosNative(int X, int Y);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    }

    // ---------------------------------------------------------------------
    // DataChannel wiring + control message handling
    // ---------------------------------------------------------------------

    private void HookInputChannel(RTCDataChannel dc)
    {
        try
        {
            dc.onopen += () => _log.LogInformation("RemoteConsole input dc open session={SessionId}", SessionId);
            dc.onclose += () => _log.LogInformation("RemoteConsole input dc closed session={SessionId}", SessionId);

            AddDataChannelOnMessage(dc, (obj) =>
            {
                try
                {
                    var text = obj?.ToString() ?? "";
                    if (string.IsNullOrWhiteSpace(text)) return;
                    OnTextFromTech?.Invoke(text);
                }
                catch { }
            });
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "HookInputChannel failed session={SessionId}", SessionId);
        }
    }

    private void HookControlChannel(RTCDataChannel dc)
    {
        try
        {
            dc.onopen += () => _log.LogInformation("RemoteConsole control dc open session={SessionId}", SessionId);
            dc.onclose += () => _log.LogInformation("RemoteConsole control dc closed session={SessionId}", SessionId);

            AddDataChannelOnMessage(dc, (obj) =>
            {
                try
                {
                    var raw = obj?.ToString() ?? "";
                    if (string.IsNullOrWhiteSpace(raw)) return;

                    using var doc = JsonDocument.Parse(raw);
                    var root = doc.RootElement;

                    OnControlFromTech?.Invoke(root);
                    HandleControl(root);
                }
                catch (Exception ex)
                {
                    _log.LogDebug(ex, "RemoteConsole control message parse failed session={SessionId}", SessionId);
                }
            });
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "HookControlChannel failed session={SessionId}", SessionId);
        }
    }

    private void HandleControl(JsonElement msg)
    {
        if (_closed) return;

        var type = msg.TryGetProperty("type", out var t) ? (t.GetString() ?? "") : "";
        if (string.IsNullOrWhiteSpace(type)) return;

        if (_desktopGeom.IsUnknown)
        {
            try
            {
                var proc = Process.GetCurrentProcess();
                _desktopGeom = DesktopGeometry.ReadCurrent(proc.SessionId == 0);
            }
            catch { }
        }

        try
        {
            switch (type)
            {
                case "focus":
                case "blur":
                    _input.ReleaseAll();
                    break;

                case "mouse.move":
                    HandleMouseMove(msg);
                    break;

                case "mouse.down":
                    HandleMouseButton(msg, down: true);
                    break;

                case "mouse.up":
                    HandleMouseButton(msg, down: false);
                    break;

                case "mouse.wheel":
                    HandleMouseWheel(msg);
                    break;

                case "key.down":
                    HandleKey(msg, down: true);
                    break;

                case "key.up":
                    HandleKey(msg, down: false);
                    break;
            }
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "RemoteConsole control handling failed session={SessionId} type={Type}", SessionId, type);
        }
    }

    private void HandleMouseMove(JsonElement msg)
    {
        var (alt, ctrl, shift, meta) = ReadMods(msg);
        _input.SyncModifiers(alt, ctrl, shift, meta);

        if (!TryReadDouble(msg, "x", out var nx)) return;
        if (!TryReadDouble(msg, "y", out var ny)) return;

        var p = MapNormToDesktop(nx, ny);
        _input.SetCursorPos(p.x, p.y);
    }

    private void HandleMouseButton(JsonElement msg, bool down)
    {
        var (alt, ctrl, shift, meta) = ReadMods(msg);
        _input.SyncModifiers(alt, ctrl, shift, meta);

        if (TryReadDouble(msg, "x", out var nx) && TryReadDouble(msg, "y", out var ny))
        {
            var p = MapNormToDesktop(nx, ny);
            _input.SetCursorPos(p.x, p.y);
        }

        int btn = msg.TryGetProperty("button", out var b) ? b.GetInt32() : 0;
        var which = btn switch
        {
            0 => MouseButton.Left,
            1 => MouseButton.Middle,
            2 => MouseButton.Right,
            _ => MouseButton.Left
        };

        _input.MouseBtn(down, which);
    }

    private void HandleMouseWheel(JsonElement msg)
    {
        var (alt, ctrl, shift, meta) = ReadMods(msg);
        _input.SyncModifiers(alt, ctrl, shift, meta);

        double dx = 0;
        double dy = 0;

        if (TryReadDouble(msg, "dx", out var ddx)) dx = ddx;
        if (TryReadDouble(msg, "dy", out var ddy)) dy = ddy;

        int stepX = WheelToWindowsStep(dx);
        int stepY = WheelToWindowsStep(dy);

        if (stepY != 0) _input.MouseWheelVertical(stepY);
        if (stepX != 0) _input.MouseWheelHorizontal(stepX);
    }

    private void HandleKey(JsonElement msg, bool down)
    {
        var (alt, ctrl, shift, meta) = ReadMods(msg);
        _input.SyncModifiers(alt, ctrl, shift, meta);

        var code = msg.TryGetProperty("code", out var c) ? (c.GetString() ?? "") : "";
        var key = msg.TryGetProperty("key", out var k) ? (k.GetString() ?? "") : "";

        if (RemoteKeyMap.TryMapKey(code, key, out var vk))
        {
            _input.Key(vk, down);
        }
    }

    private (int x, int y) MapNormToDesktop(double nx, double ny)
    {
        nx = Clamp01(nx);
        ny = Clamp01(ny);

        var primary = _desktopGeom.Primary;
        if (primary.Width <= 0 || primary.Height <= 0)
        {
            primary = new Rect(0, 0, 1920, 1080);
        }

        int x = primary.Left + (int)Math.Round(nx * (primary.Width - 1));
        int y = primary.Top + (int)Math.Round(ny * (primary.Height - 1));

        return (x, y);
    }

    private static double Clamp01(double v) => v < 0 ? 0 : (v > 1 ? 1 : v);

    private static int WheelToWindowsStep(double delta)
    {
        if (delta == 0) return 0;

        var sign = delta < 0 ? -1 : 1;
        var mag = Math.Abs(delta);

        var steps = (int)Math.Clamp(Math.Round(mag / 100.0), 1, 6);
        return sign * steps * 120;
    }

    private static (bool alt, bool ctrl, bool shift, bool meta) ReadMods(JsonElement msg)
    {
        try
        {
            if (!msg.TryGetProperty("mods", out var m) || m.ValueKind != JsonValueKind.Object)
                return (false, false, false, false);

            bool alt = m.TryGetProperty("alt", out var a) && a.ValueKind == JsonValueKind.True;
            bool ctrl = m.TryGetProperty("ctrl", out var c) && c.ValueKind == JsonValueKind.True;
            bool shift = m.TryGetProperty("shift", out var s) && s.ValueKind == JsonValueKind.True;
            bool meta = m.TryGetProperty("meta", out var me) && me.ValueKind == JsonValueKind.True;

            return (alt, ctrl, shift, meta);
        }
        catch
        {
            return (false, false, false, false);
        }
    }

    private static bool TryReadDouble(JsonElement obj, string prop, out double value)
    {
        value = 0;
        if (!obj.TryGetProperty(prop, out var p)) return false;

        try
        {
            if (p.ValueKind == JsonValueKind.Number) { value = p.GetDouble(); return true; }
            if (p.ValueKind == JsonValueKind.String && double.TryParse(p.GetString(), out var d)) { value = d; return true; }
        }
        catch { }
        return false;
    }

    private void HookDataChannelDynamic(RTCDataChannel dc)
    {
        if (dc == null) return;

        if (!_dcMembersDumped)
        {
            _dcMembersDumped = true;
            try
            {
                var t = dc.GetType();
                var methods = t.GetMethods(BindingFlags.Instance | BindingFlags.Public)
                    .Select(m => m.Name)
                    .Distinct()
                    .OrderBy(x => x)
                    .ToArray();
                _log.LogDebug("RTCDataChannel public methods: {Methods}", string.Join(", ", methods));
            }
            catch { }
        }
    }

    private void AddDataChannelOnMessage(RTCDataChannel dc, Action<object?> onMessageValue)
    {
        if (dc == null) return;

        try
        {
            var t = dc.GetType();

            foreach (var name in new[] { "onmessage", "onMessage", "OnMessage", "message", "Message" })
            {
                var fld = t.GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (fld != null && typeof(Delegate).IsAssignableFrom(fld.FieldType))
                {
                    var add = BuildOnMessageDelegate(dc, fld.FieldType, onMessageValue);
                    var existing = fld.GetValue(dc) as Delegate;
                    fld.SetValue(dc, CombineDelegate(existing, add));
                    return;
                }

                var prop = t.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (prop != null && prop.CanRead && prop.CanWrite && typeof(Delegate).IsAssignableFrom(prop.PropertyType))
                {
                    var add = BuildOnMessageDelegate(dc, prop.PropertyType, onMessageValue);
                    var existing = prop.GetValue(dc) as Delegate;
                    prop.SetValue(dc, CombineDelegate(existing, add));
                    return;
                }
            }

            var evt = t.GetEvent("OnMessage", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                   ?? t.GetEvent("onmessage", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);

            if (evt != null)
            {
                var add = BuildOnMessageDelegate(dc, evt.EventHandlerType!, onMessageValue);
                evt.AddEventHandler(dc, add);
                return;
            }

            _log.LogWarning("RTCDataChannel has no discoverable onmessage delegate/event. type={Type}", t.FullName);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "AddDataChannelOnMessage failed session={SessionId}", SessionId);
        }
    }

    private static Delegate CombineDelegate(Delegate? existing, Delegate add)
    {
        if (existing == null) return add;
        try { return Delegate.Combine(existing, add); } catch { return add; }
    }

    private Delegate BuildOnMessageDelegate(RTCDataChannel dc, Type delegateType, Action<object?> onMessageValue)
    {
        var invoke = delegateType.GetMethod("Invoke");
        var parms = invoke?.GetParameters() ?? Array.Empty<ParameterInfo>();

        if (parms.Length == 0)
        {
            Action handler0 = () =>
            {
                object? val = TryGetLastDcMessage(dc);
                onMessageValue(val);
            };
            return Delegate.CreateDelegate(delegateType, handler0.Target!, handler0.Method);
        }

        if (parms.Length == 1)
        {
            var p0 = parms[0].ParameterType;
            var wrapper = new OnMessageWrapper(dc, onMessageValue);
            var mi = typeof(OnMessageWrapper).GetMethod(nameof(OnMessageWrapper.Invoke1), BindingFlags.Instance | BindingFlags.Public)!.MakeGenericMethod(p0);
            return Delegate.CreateDelegate(delegateType, wrapper, mi);
        }

        if (parms.Length == 2)
        {
            var p0 = parms[0].ParameterType;
            var p1 = parms[1].ParameterType;

            var wrapper = new OnMessageWrapper(dc, onMessageValue);
            var mi = typeof(OnMessageWrapper).GetMethod(nameof(OnMessageWrapper.Invoke2), BindingFlags.Instance | BindingFlags.Public)!.MakeGenericMethod(p0, p1);
            return Delegate.CreateDelegate(delegateType, wrapper, mi);
        }

        Action fallback = () => onMessageValue(TryGetLastDcMessage(dc));
        return Delegate.CreateDelegate(delegateType, fallback.Target!, fallback.Method);
    }

    private sealed class OnMessageWrapper
    {
        private readonly RTCDataChannel _dc;
        private readonly Action<object?> _sink;

        public OnMessageWrapper(RTCDataChannel dc, Action<object?> sink)
        {
            _dc = dc;
            _sink = sink;
        }

        public void Invoke1<T0>(T0 a0)
        {
            _sink(ExtractMessageValue(a0) ?? TryGetLastDcMessage(_dc));
        }

        public void Invoke2<T0, T1>(T0 a0, T1 a1)
        {
            _sink(ExtractMessageValue(a0) ?? ExtractMessageValue(a1) ?? TryGetLastDcMessage(_dc));
        }

        private static object? ExtractMessageValue(object? obj)
        {
            if (obj == null) return null;

            try
            {
                var t = obj.GetType();
                var prop = t.GetProperty("data", BindingFlags.Instance | BindingFlags.Public | BindingFlags.IgnoreCase);
                if (prop != null)
                {
                    var d = prop.GetValue(obj);
                    return d ?? obj;
                }
            }
            catch { }

            return obj;
        }
    }

    private static object? TryGetLastDcMessage(RTCDataChannel dc)
    {
        try
        {
            var t = dc.GetType();

            var candidates = new[]
            {
                "lastMessage", "LastMessage",
                "last_message", "Last_Message",
                "lastMessageString", "LastMessageString",
                "lastMessageData", "LastMessageData",
                "message", "Message"
            };

            foreach (var name in candidates)
            {
                var p = t.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (p != null)
                {
                    var v = p.GetValue(dc);
                    if (v != null) return v;
                }

                var f = t.GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (f != null)
                {
                    var v = f.GetValue(dc);
                    if (v != null) return v;
                }
            }

            foreach (var mName in new[] { "receive", "Receive", "read", "Read" })
            {
                var m = t.GetMethod(mName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, Type.DefaultBinder, Type.EmptyTypes, null);
                if (m != null)
                {
                    var v = m.Invoke(dc, Array.Empty<object>());
                    if (v != null) return v;
                }
            }
        }
        catch { }

        return null;
    }

    private static bool TryDcSend(RTCDataChannel? dc, string text)
    {
        if (dc == null) return false;

        try
        {
            var t = dc.GetType();
            var m = t.GetMethod("send", new[] { typeof(string) }) ?? t.GetMethod("Send", new[] { typeof(string) });
            if (m == null) return false;
            m.Invoke(dc, new object[] { text });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void TryDcClose(RTCDataChannel? dc)
    {
        if (dc == null) return;

        try
        {
            var t = dc.GetType();
            var m = t.GetMethod("close", Type.EmptyTypes) ?? t.GetMethod("Close", Type.EmptyTypes);
            m?.Invoke(dc, Array.Empty<object>());
        }
        catch { }
    }

    private static void TryConfigureEncoderBestEffort(IVideoEncoder enc, int startKbps, int maxKbps, int fps, ILogger log, string sessionId)
    {
        try
        {
            var t = enc.GetType();
            void SetInt(string name, int value)
            {
                var p = t.GetProperty(name, BindingFlags.Instance | BindingFlags.Public);
                if (p != null && p.CanWrite && p.PropertyType == typeof(int))
                {
                    p.SetValue(enc, value);
                }
            }

            SetInt("TargetBitrate", startKbps);
            SetInt("Bitrate", startKbps);
            SetInt("MaxBitrate", maxKbps);
            SetInt("MaxKbps", maxKbps);
            SetInt("FramesPerSecond", fps);
            SetInt("FPS", fps);

            log.LogInformation("RemoteConsole encoder configured best-effort session={SessionId} startKbps={Start} maxKbps={Max} fps={Fps}", sessionId, startKbps, maxKbps, fps);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "RemoteConsole encoder configure best-effort failed session={SessionId}", sessionId);
        }
    }

    private static async Task<bool> SetRemoteDescriptionCompatAsync(RTCPeerConnection pc, RTCSessionDescriptionInit desc, ILogger log, string sessionId)
    {
        try
        {
            var mi = pc.GetType().GetMethod("setRemoteDescription", new[] { typeof(RTCSessionDescriptionInit) });
            if (mi == null) throw new MissingMethodException("RTCPeerConnection.setRemoteDescription not found.");

            var result = mi.Invoke(pc, new object[] { desc });
            if (result is Task task)
            {
                await task.ConfigureAwait(false);
                return true;
            }

            if (result is SetDescriptionResultEnum en)
            {
                if (en != SetDescriptionResultEnum.OK)
                    log.LogWarning("RemoteConsole setRemoteDescription returned {Result} session={SessionId}", en, sessionId);
                return en == SetDescriptionResultEnum.OK;
            }

            return true;
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "RemoteConsole setRemoteDescription failed session={SessionId}", sessionId);
            return false;
        }
    }

    private static async Task<bool> SetLocalDescriptionCompatAsync(RTCPeerConnection pc, RTCSessionDescriptionInit desc, ILogger log, string sessionId)
    {
        try
        {
            var mi = pc.GetType().GetMethod("setLocalDescription", new[] { typeof(RTCSessionDescriptionInit) });
            if (mi == null) throw new MissingMethodException("RTCPeerConnection.setLocalDescription not found.");

            var result = mi.Invoke(pc, new object[] { desc });
            if (result is Task task)
            {
                await task.ConfigureAwait(false);
                return true;
            }

            if (result is SetDescriptionResultEnum en)
            {
                if (en != SetDescriptionResultEnum.OK)
                    log.LogWarning("RemoteConsole setLocalDescription returned {Result} session={SessionId}", en, sessionId);
                return en == SetDescriptionResultEnum.OK;
            }

            return true;
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "RemoteConsole setLocalDescription failed session={SessionId}", sessionId);
            return false;
        }
    }

    private static async Task AddIceCandidateCompatAsync(RTCPeerConnection pc, RTCIceCandidateInit cand, ILogger log, string sessionId)
    {
        try
        {
            var mi = pc.GetType().GetMethod("addIceCandidate", new[] { typeof(RTCIceCandidateInit) });
            if (mi == null) throw new MissingMethodException("RTCPeerConnection.addIceCandidate not found.");

            var result = mi.Invoke(pc, new object[] { cand });
            if (result is Task task)
            {
                await task.ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "RemoteConsole addIceCandidate failed session={SessionId}", sessionId);
        }
    }

    // ---------------------------------------------------------------------
    // IWebRtcConsolePeer interface compliance
    // ---------------------------------------------------------------------

    public async Task HandleSignalAsync(object signal, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return;
        if (_closed) return;

        EnsurePeerCreated();
        var pc = _pc;
        if (pc == null) return;

        JsonElement? je = null;

        try
        {
            if (signal is JsonElement j0)
            {
                je = j0;
            }
            else if (signal is string s && !string.IsNullOrWhiteSpace(s))
            {
                using var doc = JsonDocument.Parse(s);
                je = doc.RootElement.Clone();
            }
            else
            {
                var json = JsonSerializer.Serialize(signal);
                using var doc = JsonDocument.Parse(json);
                je = doc.RootElement.Clone();
            }
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "RemoteConsole HandleSignalAsync: unable to parse signal session={SessionId}", SessionId);
            return;
        }

        if (je == null) return;
        var root = je.Value;

        var type = root.TryGetProperty("type", out var t) ? (t.GetString() ?? "") : "";

        if (string.Equals(type, "tech.hangup", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(type, "hangup", StringComparison.OrdinalIgnoreCase))
        {
            await CloseAsync("hangup", ct).ConfigureAwait(false);
            return;
        }

        if (string.Equals(type, "offer", StringComparison.OrdinalIgnoreCase))
        {
            var sdp = root.TryGetProperty("sdp", out var s) ? (s.GetString() ?? "") : "";
            if (string.IsNullOrWhiteSpace(sdp)) return;

            try
            {
                var okRemote = await SetRemoteDescriptionCompatAsync(pc, new RTCSessionDescriptionInit
                {
                    type = RTCSdpType.offer,
                    sdp = sdp
                }, _log, SessionId).ConfigureAwait(false);

                if (!okRemote)
                {
                    _log.LogWarning("RemoteConsole setRemoteDescription failed (compat) session={SessionId}", SessionId);
                }

                var answer = pc.createAnswer(null);
                var answerSdp = answer?.sdp ?? "";

                // ✅ Prefer VP9 primary, VP8 fallback + bitrate hints
                answerSdp = SdpUtil.PreferVp9Vp8AndSetBitrateHints(answerSdp, _targetKbps, _maxKbps);

                var okLocal = await SetLocalDescriptionCompatAsync(pc, new RTCSessionDescriptionInit
                {
                    type = RTCSdpType.answer,
                    sdp = answerSdp
                }, _log, SessionId).ConfigureAwait(false);

                if (!okLocal)
                {
                    _log.LogWarning("RemoteConsole setLocalDescription failed (compat) session={SessionId}", SessionId);
                }

                OnSignalToSend?.Invoke(new
                {
                    type = "answer",
                    sdp = answerSdp
                });

                _log.LogInformation("RemoteConsole answered offer session={SessionId}", SessionId);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "RemoteConsole failed to handle offer session={SessionId}", SessionId);
            }

            return;
        }

        if (root.TryGetProperty("candidate", out var candProp))
        {
            var candStr = candProp.GetString() ?? "";
            if (string.IsNullOrWhiteSpace(candStr)) return;

            try
            {
                string? sdpMid = null;
                ushort sdpMLineIndex = 0;

                if (root.TryGetProperty("sdpMid", out var mid) && mid.ValueKind == JsonValueKind.String)
                    sdpMid = mid.GetString();

                if (root.TryGetProperty("sdpMLineIndex", out var mli) && mli.ValueKind == JsonValueKind.Number)
                {
                    var idx = mli.GetInt32();
                    if (idx >= 0 && idx <= ushort.MaxValue) sdpMLineIndex = (ushort)idx;
                }

                await AddIceCandidateCompatAsync(pc, new RTCIceCandidateInit
                {
                    candidate = candStr,
                    sdpMid = sdpMid,
                    sdpMLineIndex = sdpMLineIndex
                }, _log, SessionId).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "RemoteConsole addIceCandidate failed session={SessionId}", SessionId);
            }

            return;
        }

        if (string.Equals(type, "answer", StringComparison.OrdinalIgnoreCase))
        {
            _log.LogDebug("RemoteConsole got unexpected answer on agent side session={SessionId} (ignored)", SessionId);
            return;
        }
    }

    public Task SendTextAsync(string text, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return Task.FromCanceled(ct);
        if (_closed) return Task.CompletedTask;

        TryDcSend(_inputDc, text ?? string.Empty);
        return Task.CompletedTask;
    }

    public async Task CloseAsync(string reason, CancellationToken ct)
    {
        if (_closed) return;

        _closed = true;

        try { StopKeyframeTimer(); } catch { }

        try
        {
            await StopVideoBestEffortAsync().ConfigureAwait(false);
        }
        catch { }

        try { _input.ReleaseAll(); } catch { }

        try { TryDcClose(_inputDc); } catch { }
        try { TryDcClose(_controlDc); } catch { }

        _inputDc = null;
        _controlDc = null;

        try
        {
            _videoTrack = null;
            _videoSource = null;
            _videoEncoder = null;
            _videoAttached = false;
            _videoStarted = false;
        }
        catch { }

        try
        {
            _pc?.Close(reason ?? "closed");
        }
        catch { }

        _pc = null;

        await Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        await CloseAsync("dispose", CancellationToken.None).ConfigureAwait(false);
    }

    private static class RemoteKeyMap
    {
        public static bool TryMapKey(string code, string key, out ushort vk)
        {
            vk = 0;

            var c = (code ?? "").Trim();
            if (!string.IsNullOrWhiteSpace(c))
            {
                if (TryMapCode(c, out vk)) return true;
            }

            var k = (key ?? "").Trim();
            if (!string.IsNullOrWhiteSpace(k))
            {
                if (TryMapKeyValue(k, out vk)) return true;
            }

            return false;
        }

        private static bool TryMapCode(string code, out ushort vk)
        {
            vk = 0;

            if (code.Length == 4 && code.StartsWith("Key", StringComparison.OrdinalIgnoreCase))
            {
                char ch = code[3];
                if (ch >= 'A' && ch <= 'Z') { vk = (ushort)ch; return true; }
            }

            if (code.Length == 6 && code.StartsWith("Digit", StringComparison.OrdinalIgnoreCase))
            {
                char ch = code[5];
                if (ch >= '0' && ch <= '9') { vk = (ushort)ch; return true; }
            }

            switch (code)
            {
                case "Enter": vk = 0x0D; return true;
                case "NumpadEnter": vk = 0x0D; return true;
                case "Tab": vk = 0x09; return true;
                case "Escape": vk = 0x1B; return true;
                case "Backspace": vk = 0x08; return true;
                case "Space": vk = 0x20; return true;

                case "ArrowLeft": vk = 0x25; return true;
                case "ArrowUp": vk = 0x26; return true;
                case "ArrowRight": vk = 0x27; return true;
                case "ArrowDown": vk = 0x28; return true;

                case "Delete": vk = 0x2E; return true;
                case "Insert": vk = 0x2D; return true;
                case "Home": vk = 0x24; return true;
                case "End": vk = 0x23; return true;
                case "PageUp": vk = 0x21; return true;
                case "PageDown": vk = 0x22; return true;

                case "F1": vk = 0x70; return true;
                case "F2": vk = 0x71; return true;
                case "F3": vk = 0x72; return true;
                case "F4": vk = 0x73; return true;
                case "F5": vk = 0x74; return true;
                case "F6": vk = 0x75; return true;
                case "F7": vk = 0x76; return true;
                case "F8": vk = 0x77; return true;
                case "F9": vk = 0x78; return true;
                case "F10": vk = 0x79; return true;
                case "F11": vk = 0x7A; return true;
                case "F12": vk = 0x7B; return true;
            }

            return false;
        }

        private static bool TryMapKeyValue(string key, out ushort vk)
        {
            vk = 0;

            if (key.Length == 1)
            {
                char ch = char.ToUpperInvariant(key[0]);
                if (ch >= 'A' && ch <= 'Z') { vk = (ushort)ch; return true; }
                if (ch >= '0' && ch <= '9') { vk = (ushort)ch; return true; }
            }

            switch (key)
            {
                case "Enter": vk = 0x0D; return true;
                case "Tab": vk = 0x09; return true;
                case "Escape": vk = 0x1B; return true;
                case "Backspace": vk = 0x08; return true;
                case " ": vk = 0x20; return true;

                case "ArrowLeft": vk = 0x25; return true;
                case "ArrowUp": vk = 0x26; return true;
                case "ArrowRight": vk = 0x27; return true;
                case "ArrowDown": vk = 0x28; return true;

                case "Delete": vk = 0x2E; return true;
                case "Insert": vk = 0x2D; return true;
                case "Home": vk = 0x24; return true;
                case "End": vk = 0x23; return true;
                case "PageUp": vk = 0x21; return true;
                case "PageDown": vk = 0x22; return true;
            }

            return false;
        }
    }
}
