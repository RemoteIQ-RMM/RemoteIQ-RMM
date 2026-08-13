// agents/windows/RemoteIQ.Agent/Services/WindowsInputInjector.cs

using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class WindowsInputInjector : IRemoteConsoleInputInjector
{
    private readonly ILogger _log;

    public WindowsInputInjector(ILogger<WindowsInputInjector> log)
    {
        _log = log;
    }

    public Task ApplyAsync(RemoteConsoleControlProtocol.ControlMessage msg, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return Task.CompletedTask;
        Apply(msg);
        return Task.CompletedTask;
    }

    public void Apply(RemoteConsoleControlProtocol.ControlMessage msg)
    {
        try
        {
            switch (msg)
            {
                case RemoteConsoleControlProtocol.ControlMessage.MouseMoveNormalized m:
                    MouseMoveNormalized(m.X, m.Y);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.MouseButtonNormalized mb:
                    if (mb.X.HasValue && mb.Y.HasValue)
                        MouseMoveNormalized(mb.X.Value, mb.Y.Value);

                    MouseButton(mb.Button, mb.IsDown);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.BrowserMouseWheel wheel:
                    BrowserMouseWheel(wheel.Dx, wheel.Dy, wheel.Mode);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.ReleaseModifiers:
                    ReleaseModifierKeys();
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.MouseMoveAbs m:
                    MouseMoveAbsolute(m.X, m.Y);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.MouseMoveRel m:
                    MouseMoveRelative(m.Dx, m.Dy);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.MouseButton mb:
                    MouseButton(mb.Button, mb.IsDown);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.MouseWheel mw:
                    MouseWheel(mw.Vertical, mw.Delta);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.Key k:
                    KeyEvent(k.Vk, k.KeyName, k.IsDown);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.Text t:
                    SendUnicodeText(t.TextValue);
                    return;

                case RemoteConsoleControlProtocol.ControlMessage.Sync:
                    // No-op for now.
                    return;

                default:
                    return;
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "WindowsInputInjector Apply failed for msgType={Type}", msg?.GetType().FullName ?? "null");
        }
    }

    // REMOTEIQ_REMOTE_CONSOLE_CONTROL_PROTOCOL_V2

    private void MouseMoveNormalized(double x, double y)
    {
        if (double.IsNaN(x) || double.IsInfinity(x))
            x = 0;

        if (double.IsNaN(y) || double.IsInfinity(y))
            y = 0;

        x = Math.Clamp(x, 0.0, 1.0);
        y = Math.Clamp(y, 0.0, 1.0);

        var width =
            Math.Max(
                1,
                GetSystemMetrics(SM_CXSCREEN));

        var height =
            Math.Max(
                1,
                GetSystemMetrics(SM_CYSCREEN));

        var xPixel =
            (int)Math.Round(
                x * Math.Max(0, width - 1));

        var yPixel =
            (int)Math.Round(
                y * Math.Max(0, height - 1));

        MouseMoveAbsolute(
            xPixel,
            yPixel);
    }

    private void BrowserMouseWheel(
        double dx,
        double dy,
        string mode)
    {
        var horizontal =
            BrowserWheelDeltaToWindows(
                dx,
                mode,
                invert: false);

        var vertical =
            BrowserWheelDeltaToWindows(
                dy,
                mode,
                invert: true);

        if (vertical != 0)
            MouseWheel(true, vertical);

        if (horizontal != 0)
            MouseWheel(false, horizontal);
    }

    private static int BrowserWheelDeltaToWindows(
        double delta,
        string mode,
        bool invert)
    {
        if (delta == 0 ||
            double.IsNaN(delta) ||
            double.IsInfinity(delta))
        {
            return 0;
        }

        var divisor =
            string.Equals(
                mode,
                "line",
                StringComparison.OrdinalIgnoreCase)
                ? 3.0
                : string.Equals(
                    mode,
                    "page",
                    StringComparison.OrdinalIgnoreCase)
                    ? 1.0
                    : 100.0;

        var steps =
            (int)Math.Round(
                Math.Abs(delta) /
                divisor);

        steps =
            Math.Clamp(
                steps,
                1,
                6);

        var sign =
            delta < 0
                ? -1
                : 1;

        if (invert)
            sign *= -1;

        return sign * steps * 120;
    }

    private void ReleaseModifierKeys()
    {
        KeyEvent(0x10, null, false);
        KeyEvent(0x11, null, false);
        KeyEvent(0x12, null, false);
        KeyEvent(0x5B, null, false);
        KeyEvent(0x5C, null, false);
    }

    // -------------------- Mouse --------------------

    private void MouseMoveRelative(int dx, int dy)
    {
        INPUT[] inputs =
        {
            new INPUT
            {
                type = INPUT_MOUSE,
                U = new InputUnion
                {
                    mi = new MOUSEINPUT
                    {
                        dx = dx,
                        dy = dy,
                        dwFlags = MOUSEEVENTF_MOVE
                    }
                }
            }
        };

        SendInputChecked(inputs);
    }

    private void MouseMoveAbsolute(int xPixel, int yPixel)
    {
        var vsLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
        var vsTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
        var vsWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        var vsHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        if (vsWidth <= 0 || vsHeight <= 0)
        {
            vsLeft = 0;
            vsTop = 0;
            vsWidth = GetSystemMetrics(SM_CXSCREEN);
            vsHeight = GetSystemMetrics(SM_CYSCREEN);
        }

        var x = xPixel;
        var y = yPixel;
        if (x < vsLeft) x = vsLeft;
        if (y < vsTop) y = vsTop;
        if (x > vsLeft + vsWidth - 1) x = vsLeft + vsWidth - 1;
        if (y > vsTop + vsHeight - 1) y = vsTop + vsHeight - 1;

        var nx = (int)Math.Round(((x - vsLeft) * 65535.0) / Math.Max(1, vsWidth - 1));
        var ny = (int)Math.Round(((y - vsTop) * 65535.0) / Math.Max(1, vsHeight - 1));

        INPUT[] inputs =
        {
            new INPUT
            {
                type = INPUT_MOUSE,
                U = new InputUnion
                {
                    mi = new MOUSEINPUT
                    {
                        dx = nx,
                        dy = ny,
                        dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK
                    }
                }
            }
        };

        SendInputChecked(inputs);
    }

    private void MouseButton(RemoteConsoleControlProtocol.MouseButton button, bool isDown)
    {
        uint flag = button switch
        {
            RemoteConsoleControlProtocol.MouseButton.Left => isDown ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
            RemoteConsoleControlProtocol.MouseButton.Right => isDown ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP,
            RemoteConsoleControlProtocol.MouseButton.Middle => isDown ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP,
            RemoteConsoleControlProtocol.MouseButton.X1 => isDown ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP,
            RemoteConsoleControlProtocol.MouseButton.X2 => isDown ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP,
            _ => isDown ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP
        };

        uint mouseData = 0;
        if (button == RemoteConsoleControlProtocol.MouseButton.X1) mouseData = XBUTTON1;
        if (button == RemoteConsoleControlProtocol.MouseButton.X2) mouseData = XBUTTON2;

        INPUT[] inputs =
        {
            new INPUT
            {
                type = INPUT_MOUSE,
                U = new InputUnion
                {
                    mi = new MOUSEINPUT
                    {
                        mouseData = mouseData,
                        dwFlags = flag
                    }
                }
            }
        };

        SendInputChecked(inputs);
    }

    private void MouseWheel(bool vertical, int delta)
    {
        var flag = vertical ? MOUSEEVENTF_WHEEL : MOUSEEVENTF_HWHEEL;

        INPUT[] inputs =
        {
            new INPUT
            {
                type = INPUT_MOUSE,
                U = new InputUnion
                {
                    mi = new MOUSEINPUT
                    {
                        mouseData = (uint)delta,
                        dwFlags = flag
                    }
                }
            }
        };

        SendInputChecked(inputs);
    }

    // -------------------- Keyboard --------------------

    private void KeyEvent(int vk, string? keyName, bool isDown)
    {
        ushort vkk = (ushort)Math.Max(0, vk);

        if (vkk == 0 && !string.IsNullOrWhiteSpace(keyName))
        {
            var s = keyName.Trim();
            if (s.Length == 1)
            {
                if (isDown)
                    SendUnicodeText(s);
                return;
            }
        }

        if (vkk == 0) return;

        INPUT[] inputs =
        {
            new INPUT
            {
                type = INPUT_KEYBOARD,
                U = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = vkk,
                        wScan = 0,
                        dwFlags = isDown ? 0u : KEYEVENTF_KEYUP,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            }
        };

        SendInputChecked(inputs);
    }

    private void SendUnicodeText(string text)
    {
        if (string.IsNullOrEmpty(text)) return;

        var inputs = new INPUT[text.Length * 2];

        for (int i = 0; i < text.Length; i++)
        {
            var ch = text[i];

            inputs[i * 2] = new INPUT
            {
                type = INPUT_KEYBOARD,
                U = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = ch,
                        dwFlags = KEYEVENTF_UNICODE,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };

            inputs[i * 2 + 1] = new INPUT
            {
                type = INPUT_KEYBOARD,
                U = new InputUnion
                {
                    ki = new KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = ch,
                        dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };
        }

        SendInputChecked(inputs);
    }

    // -------------------- Win32 --------------------

    private void SendInputChecked(INPUT[] inputs)
    {
        if (inputs == null || inputs.Length == 0) return;

        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
        if (sent == 0)
        {
            var err = Marshal.GetLastWin32Error();
            _log.LogDebug("SendInput failed err={Err}", err);
        }
    }

    private const int INPUT_MOUSE = 0;
    private const int INPUT_KEYBOARD = 1;

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_XDOWN = 0x0080;
    private const uint MOUSEEVENTF_XUP = 0x0100;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_HWHEEL = 0x01000;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

    private const uint XBUTTON1 = 0x0001;
    private const uint XBUTTON2 = 0x0002;

    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;
    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public int type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
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
}
