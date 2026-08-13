// agents/windows/RemoteIQ.CaptureHelper/Program.cs

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    // Protocol:
    // Client -> Server:
    //   "RIQ1" (4 bytes)
    //   version (int32) = 1
    //   secretLen (int32)
    //   secretUtf8 (bytes)
    //
    // Then frames in a loop:
    //   width (int32)
    //   height (int32)
    //   pixelFormat (int32) 1 = BGRA32
    //   frameLenBytes (int32)
    //   frameBytes (BGRA)
    private const int PixelFormatBgra32 = 1;

    // Help avoid pipe fragmentation on large frames
    private const int PipeBufferBytes = 1 * 1024 * 1024; // 1MB

    public static int Main(string[] args)
    {
        try
        {
            // CRITICAL: Without DPI awareness, GetSystemMetrics and screen capture can be DPI-virtualized
            // (e.g. 2560x1440 @150% becomes ~1706x960) -> you capture low-res and upscale -> blurry.
            DpiUtil.TryEnablePerMonitorV2();

            var parsed = Args.Parse(args);

            if (string.IsNullOrWhiteSpace(parsed.PipeName))
                return Fail("Missing --pipe <name>.");

            if (string.IsNullOrWhiteSpace(parsed.Secret))
                return Fail("Missing --secret <token>.");

            // IMPORTANT:
            // The agent side expects *fixed* frame headers matching --w/--h.
            // So we keep the output frame size EXACTLY (w,h) and preserve aspect
            // by letterboxing/pillarboxing inside that frame.
            int outW = Math.Clamp(parsed.Width <= 0 ? 2560 : parsed.Width, 64, 7680);
            int outH = Math.Clamp(parsed.Height <= 0 ? 1440 : parsed.Height, 64, 4320);
            int fps = Math.Clamp(parsed.Fps <= 0 ? 30 : parsed.Fps, 1, 60);

            var (srcW, srcH) = ScreenCapture.GetPrimaryScreenBounds();
            if (srcW <= 0 || srcH <= 0) throw new InvalidOperationException("Primary screen bounds invalid.");

            using var pipe = new NamedPipeClientStream(
                serverName: ".",
                pipeName: parsed.PipeName,
                direction: PipeDirection.Out,
                options: PipeOptions.Asynchronous);

            // Connect with retry for a short window (service creates server first).
            var sw = Stopwatch.StartNew();
            while (true)
            {
                try
                {
                    pipe.Connect(750);
                    break;
                }
                catch
                {
                    if (sw.ElapsedMilliseconds > 15000)
                        throw new TimeoutException($"Timed out connecting to pipe '{parsed.PipeName}'.");
                }
            }

            TrySetPipeBuffer(pipe, PipeBufferBytes);

            using var bw = new BinaryWriter(pipe, Encoding.UTF8, leaveOpen: true);

            // Handshake
            bw.Write((byte)'R');
            bw.Write((byte)'I');
            bw.Write((byte)'Q');
            bw.Write((byte)'1');
            bw.Write(1); // version

            var secretBytes = Encoding.UTF8.GetBytes(parsed.Secret);
            bw.Write(secretBytes.Length);
            bw.Write(secretBytes);
            bw.Flush();

            // Capture loop timing
            int frameIntervalMs = (int)Math.Round(1000.0 / fps);
            var timer = Stopwatch.StartNew();
            long next = 0;

            // Heartbeat
            long lastHeartbeatMs = 0;
            long frames = 0;
            long bytesSent = 0;

            // Reuse buffers
            byte[]? scaledReuse = null;    // fitted image (aspect-preserved)
            byte[]? framedReuse = null;    // full outW*outH with black bars

            // Track resolution changes (common under RDP / display reconfig)
            int lastSrcW = srcW;
            int lastSrcH = srcH;

            DebugLog($"start pipe={parsed.PipeName} out={outW}x{outH} fps={fps} src={lastSrcW}x{lastSrcH}");

            while (pipe.IsConnected)
            {
                if (ConsoleCancelRequested.IsSet)
                    break;

                long now = timer.ElapsedMilliseconds;
                if (now < next)
                {
                    Thread.Sleep((int)Math.Min(10, next - now));
                    continue;
                }
                next = now + frameIntervalMs;

                // Re-check source resolution (after DPI awareness is enabled, this should be real pixels)
                var (curSrcW, curSrcH) = ScreenCapture.GetPrimaryScreenBounds();
                if (curSrcW > 0 && curSrcH > 0 && (curSrcW != lastSrcW || curSrcH != lastSrcH))
                {
                    lastSrcW = curSrcW;
                    lastSrcH = curSrcH;
                    DebugLog($"display changed src={lastSrcW}x{lastSrcH} out={outW}x{outH}");
                }

                // Capture native desktop (BGRA)
                byte[] native = ScreenCapture.CapturePrimaryScreenBgra(lastSrcW, lastSrcH);

                // Compute fitted size inside the fixed output frame (preserve aspect).
                var fit = FitInsidePreserveAspect(lastSrcW, lastSrcH, outW, outH);
                int fitW = fit.Width;
                int fitH = fit.Height;

                // If the output size matches the source, no scaling or bars needed.
                // Otherwise: scale to fitW/fitH, then letterbox into outW/outH.
                byte[] frameToSend;

                if (lastSrcW == outW && lastSrcH == outH)
                {
                    frameToSend = native;
                }
                else
                {
                    if (fitW == lastSrcW && fitH == lastSrcH)
                    {
                        EnsureFrameBuffer(ref framedReuse, outW, outH);
                        LetterboxInto(native, lastSrcW, lastSrcH, framedReuse!, outW, outH);
                        frameToSend = framedReuse!;
                    }
                    else
                    {
                        EnsureScaleBuffer(ref scaledReuse, fitW, fitH);
                        ImageScale.ScaleBgraBilinearInto(native, lastSrcW, lastSrcH, scaledReuse!, fitW, fitH);

                        EnsureFrameBuffer(ref framedReuse, outW, outH);
                        LetterboxInto(scaledReuse!, fitW, fitH, framedReuse!, outW, outH);
                        frameToSend = framedReuse!;
                    }
                }

                // CRITICAL: frame header must always be outW/outH (what the agent expects)
                WriteFrame(bw, outW, outH, frameToSend);
                bw.Flush();

                frames++;
                bytesSent += frameToSend.Length;

                if (now - lastHeartbeatMs >= 2000)
                {
                    lastHeartbeatMs = now;
                    DebugLog($"hb pipe={parsed.PipeName} frames={frames} bytes={bytesSent} src={lastSrcW}x{lastSrcH} out={outW}x{outH} fit={fitW}x{fitH} fps={fps}");
                }
            }

            return 0;
        }
        catch (Exception ex)
        {
            DebugLog(ex.ToString());
            return 1;
        }
    }

    private static void EnsureScaleBuffer(ref byte[]? buf, int w, int h)
    {
        int needed = checked(w * h * 4);
        if (buf == null || buf.Length != needed)
            buf = new byte[needed];
    }

    private static void EnsureFrameBuffer(ref byte[]? buf, int w, int h)
    {
        int needed = checked(w * h * 4);
        if (buf == null || buf.Length != needed)
            buf = new byte[needed];
    }

    private static (int Width, int Height) FitInsidePreserveAspect(int srcW, int srcH, int maxW, int maxH)
    {
        srcW = Math.Max(1, srcW);
        srcH = Math.Max(1, srcH);
        maxW = Math.Max(1, maxW);
        maxH = Math.Max(1, maxH);

        if (srcW <= maxW && srcH <= maxH)
            return (srcW, srcH);

        double scaleW = (double)maxW / srcW;
        double scaleH = (double)maxH / srcH;
        double scale = Math.Min(scaleW, scaleH);

        int outW = Math.Max(64, (int)Math.Round(srcW * scale));
        int outH = Math.Max(64, (int)Math.Round(srcH * scale));

        if (outW > maxW) outW = maxW;
        if (outH > maxH) outH = maxH;

        outW = Math.Max(64, outW);
        outH = Math.Max(64, outH);

        return (outW, outH);
    }

    // Writes src (srcW/srcH) into dst (dstW/dstH) centered with black bars.
    // Buffers are BGRA32.
    private static void LetterboxInto(byte[] src, int srcW, int srcH, byte[] dst, int dstW, int dstH)
    {
        for (int i = 0; i < dst.Length; i += 4)
        {
            dst[i + 0] = 0;   // B
            dst[i + 1] = 0;   // G
            dst[i + 2] = 0;   // R
            dst[i + 3] = 255; // A
        }

        int offX = (dstW - srcW) / 2;
        int offY = (dstH - srcH) / 2;

        if (offX < 0 || offY < 0)
            throw new InvalidOperationException($"LetterboxInto: src {srcW}x{srcH} larger than dst {dstW}x{dstH}.");

        int bytesPerPixel = 4;
        int srcStride = srcW * bytesPerPixel;
        int dstStride = dstW * bytesPerPixel;

        for (int y = 0; y < srcH; y++)
        {
            int srcRow = y * srcStride;
            int dstRow = (y + offY) * dstStride + offX * bytesPerPixel;
            Buffer.BlockCopy(src, srcRow, dst, dstRow, srcStride);
        }
    }

    private static int Fail(string msg)
    {
        DebugLog(msg);
        return 2;
    }

    private static void WriteFrame(BinaryWriter bw, int w, int h, byte[] frameBgra)
    {
        bw.Write(w);
        bw.Write(h);
        bw.Write(PixelFormatBgra32);
        bw.Write(frameBgra.Length);
        bw.Write(frameBgra);
    }

    private sealed class Args
    {
        public string PipeName { get; private set; } = "";
        public string Secret { get; private set; } = "";
        public int Width { get; private set; }
        public int Height { get; private set; }
        public int Fps { get; private set; }

        public static Args Parse(string[] args)
        {
            var a = new Args();
            for (int i = 0; i < args.Length; i++)
            {
                var k = args[i];
                string v = (i + 1 < args.Length) ? args[i + 1] : "";

                if (k.Equals("--pipe", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    a.PipeName = v; i++;
                }
                else if (k.Equals("--secret", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    a.Secret = v; i++;
                }
                else if (k.Equals("--w", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length && int.TryParse(v, out var wi))
                {
                    a.Width = wi; i++;
                }
                else if (k.Equals("--h", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length && int.TryParse(v, out var hi))
                {
                    a.Height = hi; i++;
                }
                else if (k.Equals("--fps", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length && int.TryParse(v, out var fi))
                {
                    a.Fps = fi; i++;
                }
            }
            return a;
        }
    }

    private static class ImageScale
    {
        public static void ScaleBgraBilinearInto(byte[] src, int srcW, int srcH, byte[] dst, int dstW, int dstH)
        {
            if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0)
                throw new ArgumentOutOfRangeException("invalid dimensions");

            int dstBytes = checked(dstW * dstH * 4);
            if (dst.Length < dstBytes)
                throw new ArgumentException("dst buffer too small", nameof(dst));

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

                        int iv = (int)Math.Round(v);
                        if (iv < 0) iv = 0;
                        else if (iv > 255) iv = 255;

                        dst[d + c] = (byte)iv;
                    }
                }
            }
        }
    }

    private static class ScreenCapture
    {
        public static (int Width, int Height) GetPrimaryScreenBounds()
        {
            int w = GetSystemMetrics(SM_CXSCREEN);
            int h = GetSystemMetrics(SM_CYSCREEN);
            return (Math.Max(1, w), Math.Max(1, h));
        }

        public static byte[] CapturePrimaryScreenBgra(int w, int h)
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
                bmi.bmiHeader.biHeight = -h; // top-down
                bmi.bmiHeader.biPlanes = 1;
                bmi.bmiHeader.biBitCount = 32;
                bmi.bmiHeader.biCompression = BI_RGB;

                IntPtr ppvBits;
                hBmp = CreateDIBSection(hSrcDc, ref bmi, DIB_RGB_COLORS, out ppvBits, IntPtr.Zero, 0);
                if (hBmp == IntPtr.Zero || ppvBits == IntPtr.Zero)
                    throw new InvalidOperationException("CreateDIBSection failed.");

                hOld = SelectObject(hMemDc, hBmp);
                if (hOld == IntPtr.Zero) throw new InvalidOperationException("SelectObject failed.");

                bool ok = BitBlt(
                    hMemDc,
                    0, 0, w, h,
                    hSrcDc,
                    0, 0,
                    SRCCOPY | CAPTUREBLT);

                if (!ok)
                {
                    var err = Marshal.GetLastWin32Error();
                    throw new InvalidOperationException($"BitBlt failed. GetLastError={err} (0x{err:X8}).");
                }

                int bytes = checked(w * h * 4);
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

        private const int SM_CXSCREEN = 0;
        private const int SM_CYSCREEN = 1;

        private const int SRCCOPY = 0x00CC0020;
        private const int CAPTUREBLT = 0x40000000;

        private const uint BI_RGB = 0;
        private const uint DIB_RGB_COLORS = 0;

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
            public int biYPelsPerMeter;
            public uint biClrUsed;
            public uint biClrImportant;
        }

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int nIndex);

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

    // ------------------------ Utilities ------------------------

    private static class ConsoleCancelRequested
    {
        private static int _set;

        public static bool IsSet => Volatile.Read(ref _set) == 1;

        static ConsoleCancelRequested()
        {
            try
            {
                Console.CancelKeyPress += (_, e) =>
                {
                    e.Cancel = true;
                    Interlocked.Exchange(ref _set, 1);
                };
            }
            catch
            {
                // In WinExe there may not be a console; ignore.
            }
        }
    }

    private static void DebugLog(string message)
    {
        try { Debug.WriteLine(message); } catch { }
        try { OutputDebugString($"RemoteIQ.CaptureHelper: {message}\n"); } catch { }
    }

    private static void TrySetPipeBuffer(NamedPipeClientStream pipe, int bytes)
    {
        try
        {
            _ = pipe;
            _ = bytes;
        }
        catch
        {
            // ignore
        }
    }

    private static class DpiUtil
    {
        public static void TryEnablePerMonitorV2()
        {
            try
            {
                // PER_MONITOR_AWARE_V2
                SetProcessDpiAwarenessContext(new IntPtr(-4));
            }
            catch
            {
                // ignore
            }
        }

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiFlag);
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern void OutputDebugString(string lpOutputString);
}
