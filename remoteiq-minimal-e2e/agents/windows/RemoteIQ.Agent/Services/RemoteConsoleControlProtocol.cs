// agents/windows/RemoteIQ.Agent/Services/RemoteConsoleControlProtocol.cs

using System;
using System.Globalization;
using System.Text.Json;

namespace RemoteIQ.Agent.Services;

/// <summary>
/// Canonical RemoteIQ rc.control protocol.
///
/// Browser packets use the "type" discriminator with normalized desktop
/// coordinates. Legacy local packets using "t" remain accepted while the
/// Remote Console implementation is being consolidated.
/// </summary>
public static class RemoteConsoleControlProtocol
{
    // REMOTEIQ_REMOTE_CONSOLE_CONTROL_PROTOCOL_V2

    public const string TypeField = "type";
    public const string LegacyTypeField = "t";

    public static bool TryParse(JsonElement root, out ControlMessage msg)
    {
        msg = default!;

        if (root.ValueKind != JsonValueKind.Object)
            return false;

        var browserType = GetString(root, TypeField);

        if (!string.IsNullOrWhiteSpace(browserType))
        {
            return TryParseBrowser(
                root,
                browserType.Trim().ToLowerInvariant(),
                out msg);
        }

        var legacyType = GetString(root, LegacyTypeField);

        if (string.IsNullOrWhiteSpace(legacyType))
            return false;

        return TryParseLegacy(
            root,
            legacyType.Trim().ToLowerInvariant(),
            out msg);
    }

    private static bool TryParseBrowser(
        JsonElement root,
        string type,
        out ControlMessage msg)
    {
        msg = default!;

        switch (type)
        {
            case "focus":
                msg = new ControlMessage.Sync(false, false, false);
                return true;

            case "blur":
                msg = new ControlMessage.ReleaseModifiers();
                return true;

            case "mouse.move":
            {
                if (!TryGetDouble(root, "x", out var x) ||
                    !TryGetDouble(root, "y", out var y))
                {
                    return false;
                }

                msg = new ControlMessage.MouseMoveNormalized(
                    Clamp01(x),
                    Clamp01(y));

                return true;
            }

            case "mouse.down":
            case "mouse.up":
            {
                var buttonNumber =
                    GetInt(root, "button", 0);

                var button = buttonNumber switch
                {
                    0 => MouseButton.Left,
                    1 => MouseButton.Middle,
                    2 => MouseButton.Right,
                    3 => MouseButton.X1,
                    4 => MouseButton.X2,
                    _ => MouseButton.Left
                };

                double? x = null;
                double? y = null;

                if (TryGetDouble(root, "x", out var parsedX))
                    x = Clamp01(parsedX);

                if (TryGetDouble(root, "y", out var parsedY))
                    y = Clamp01(parsedY);

                msg = new ControlMessage.MouseButtonNormalized(
                    type == "mouse.down",
                    button,
                    x,
                    y);

                return true;
            }

            case "mouse.wheel":
            {
                var dx = GetDouble(root, "dx", 0);
                var dy = GetDouble(root, "dy", 0);

                var mode =
                    (GetString(root, "mode") ?? "pixel")
                    .Trim()
                    .ToLowerInvariant();

                if (mode != "pixel" &&
                    mode != "line" &&
                    mode != "page")
                {
                    mode = "pixel";
                }

                msg = new ControlMessage.BrowserMouseWheel(
                    dx,
                    dy,
                    mode);

                return true;
            }

            case "key.down":
            case "key.up":
            {
                var code = GetString(root, "code") ?? string.Empty;
                var key = GetString(root, "key") ?? string.Empty;

                if (code.Length > 128 || key.Length > 128)
                    return false;

                var vk = -1;

                if (TryMapBrowserKey(code, key, out var mappedVk))
                    vk = mappedVk;

                msg = new ControlMessage.Key(
                    type == "key.down",
                    vk,
                    key);

                return true;
            }

            case "text":
            {
                var text = GetString(root, "text") ?? string.Empty;

                if (text.Length > 65536)
                    return false;

                msg = new ControlMessage.Text(text);
                return true;
            }

            case "sync":
            {
                msg = new ControlMessage.Sync(
                    GetBool(root, "caps", false),
                    GetBool(root, "num", false),
                    GetBool(root, "scroll", false));

                return true;
            }

            default:
                return false;
        }
    }

    private static bool TryParseLegacy(
        JsonElement root,
        string type,
        out ControlMessage msg)
    {
        msg = default!;

        switch (type)
        {
            case "mouse.move":
            {
                var mode =
                    (GetString(root, "mode") ?? "abs")
                    .Trim()
                    .ToLowerInvariant();

                if (mode == "rel")
                {
                    msg = new ControlMessage.MouseMoveRel(
                        GetInt(root, "dx", 0),
                        GetInt(root, "dy", 0));

                    return true;
                }

                var x = GetInt(root, "x", int.MinValue);
                var y = GetInt(root, "y", int.MinValue);

                if (x == int.MinValue || y == int.MinValue)
                    return false;

                msg = new ControlMessage.MouseMoveAbs(x, y);
                return true;
            }

            case "mouse.down":
            {
                var btn =
                    (GetString(root, "btn") ?? "left")
                    .Trim()
                    .ToLowerInvariant();

                msg = new ControlMessage.MouseButton(
                    true,
                    ParseButton(btn));

                return true;
            }

            case "mouse.up":
            {
                var btn =
                    (GetString(root, "btn") ?? "left")
                    .Trim()
                    .ToLowerInvariant();

                msg = new ControlMessage.MouseButton(
                    false,
                    ParseButton(btn));

                return true;
            }

            case "mouse.wheel":
            {
                msg = new ControlMessage.MouseWheel(
                    true,
                    GetInt(root, "dy", 0));

                return true;
            }

            case "mouse.hwheel":
            {
                msg = new ControlMessage.MouseWheel(
                    false,
                    GetInt(root, "dx", 0));

                return true;
            }

            case "key.down":
            {
                msg = new ControlMessage.Key(
                    true,
                    GetInt(root, "vk", -1),
                    GetString(root, "key"));

                return true;
            }

            case "key.up":
            {
                msg = new ControlMessage.Key(
                    false,
                    GetInt(root, "vk", -1),
                    GetString(root, "key"));

                return true;
            }

            case "text":
            {
                var text = GetString(root, "text") ?? string.Empty;

                if (text.Length > 65536)
                    return false;

                msg = new ControlMessage.Text(text);
                return true;
            }

            case "sync":
            {
                msg = new ControlMessage.Sync(
                    GetBool(root, "caps", false),
                    GetBool(root, "num", false),
                    GetBool(root, "scroll", false));

                return true;
            }

            default:
                return false;
        }
    }

    private static bool TryMapBrowserKey(
        string code,
        string key,
        out int vk)
    {
        vk = -1;

        code = (code ?? string.Empty).Trim();

        if (code.Length == 4 &&
            code.StartsWith("Key", StringComparison.Ordinal) &&
            code[3] >= 'A' &&
            code[3] <= 'Z')
        {
            vk = code[3];
            return true;
        }

        if (code.Length == 6 &&
            code.StartsWith("Digit", StringComparison.Ordinal) &&
            code[5] >= '0' &&
            code[5] <= '9')
        {
            vk = code[5];
            return true;
        }

        if (code.Length == 7 &&
            code.StartsWith("Numpad", StringComparison.Ordinal) &&
            code[6] >= '0' &&
            code[6] <= '9')
        {
            vk = 0x60 + (code[6] - '0');
            return true;
        }

        if (code.StartsWith("F", StringComparison.Ordinal) &&
            int.TryParse(code.Substring(1), out var fn) &&
            fn >= 1 &&
            fn <= 24)
        {
            vk = 0x70 + fn - 1;
            return true;
        }

        switch (code)
        {
            case "Backspace": vk = 0x08; return true;
            case "Tab": vk = 0x09; return true;
            case "Enter":
            case "NumpadEnter": vk = 0x0D; return true;

            case "ShiftLeft":
            case "ShiftRight": vk = 0x10; return true;

            case "ControlLeft":
            case "ControlRight": vk = 0x11; return true;

            case "AltLeft":
            case "AltRight": vk = 0x12; return true;

            case "Pause": vk = 0x13; return true;
            case "CapsLock": vk = 0x14; return true;
            case "Escape": vk = 0x1B; return true;
            case "Space": vk = 0x20; return true;

            case "PageUp": vk = 0x21; return true;
            case "PageDown": vk = 0x22; return true;
            case "End": vk = 0x23; return true;
            case "Home": vk = 0x24; return true;
            case "ArrowLeft": vk = 0x25; return true;
            case "ArrowUp": vk = 0x26; return true;
            case "ArrowRight": vk = 0x27; return true;
            case "ArrowDown": vk = 0x28; return true;

            case "PrintScreen": vk = 0x2C; return true;
            case "Insert": vk = 0x2D; return true;
            case "Delete": vk = 0x2E; return true;

            case "MetaLeft": vk = 0x5B; return true;
            case "MetaRight": vk = 0x5C; return true;
            case "ContextMenu": vk = 0x5D; return true;

            case "NumpadMultiply": vk = 0x6A; return true;
            case "NumpadAdd": vk = 0x6B; return true;
            case "NumpadSubtract": vk = 0x6D; return true;
            case "NumpadDecimal": vk = 0x6E; return true;
            case "NumpadDivide": vk = 0x6F; return true;

            case "NumLock": vk = 0x90; return true;
            case "ScrollLock": vk = 0x91; return true;

            case "Semicolon": vk = 0xBA; return true;
            case "Equal": vk = 0xBB; return true;
            case "Comma": vk = 0xBC; return true;
            case "Minus": vk = 0xBD; return true;
            case "Period": vk = 0xBE; return true;
            case "Slash": vk = 0xBF; return true;
            case "Backquote": vk = 0xC0; return true;
            case "BracketLeft": vk = 0xDB; return true;
            case "Backslash": vk = 0xDC; return true;
            case "BracketRight": vk = 0xDD; return true;
            case "Quote": vk = 0xDE; return true;
        }

        if (key.Length == 1)
        {
            var ch = char.ToUpperInvariant(key[0]);

            if (ch >= 'A' && ch <= 'Z')
            {
                vk = ch;
                return true;
            }

            if (ch >= '0' && ch <= '9')
            {
                vk = ch;
                return true;
            }
        }

        return false;
    }

    private static MouseButton ParseButton(string btn)
    {
        return btn switch
        {
            "left" => MouseButton.Left,
            "right" => MouseButton.Right,
            "middle" => MouseButton.Middle,
            "x1" => MouseButton.X1,
            "x2" => MouseButton.X2,
            _ => MouseButton.Left
        };
    }

    private static double Clamp01(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
            return 0;

        if (value <= 0)
            return 0;

        if (value >= 1)
            return 1;

        return value;
    }

    private static string? GetString(
        JsonElement obj,
        string name)
    {
        if (!obj.TryGetProperty(name, out var value))
            return null;

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null
        };
    }

    private static int GetInt(
        JsonElement obj,
        string name,
        int fallback)
    {
        if (!obj.TryGetProperty(name, out var value))
            return fallback;

        if (value.ValueKind == JsonValueKind.Number)
        {
            if (value.TryGetInt32(out var i32))
                return i32;

            if (value.TryGetInt64(out var i64))
            {
                if (i64 > int.MaxValue)
                    return int.MaxValue;

                if (i64 < int.MinValue)
                    return int.MinValue;

                return (int)i64;
            }

            if (value.TryGetDouble(out var d))
            {
                if (double.IsNaN(d) || double.IsInfinity(d))
                    return fallback;

                if (d > int.MaxValue)
                    return int.MaxValue;

                if (d < int.MinValue)
                    return int.MinValue;

                return (int)d;
            }
        }

        if (value.ValueKind == JsonValueKind.String)
        {
            var raw = value.GetString();

            if (int.TryParse(
                    raw,
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out var integer))
            {
                return integer;
            }
        }

        return fallback;
    }

    private static double GetDouble(
        JsonElement obj,
        string name,
        double fallback)
    {
        return TryGetDouble(obj, name, out var value)
            ? value
            : fallback;
    }

    private static bool TryGetDouble(
        JsonElement obj,
        string name,
        out double value)
    {
        value = 0;

        if (!obj.TryGetProperty(name, out var element))
            return false;

        if (element.ValueKind == JsonValueKind.Number &&
            element.TryGetDouble(out value))
        {
            return !double.IsNaN(value) &&
                   !double.IsInfinity(value);
        }

        if (element.ValueKind == JsonValueKind.String)
        {
            var raw = element.GetString();

            if (double.TryParse(
                    raw,
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out value))
            {
                return !double.IsNaN(value) &&
                       !double.IsInfinity(value);
            }
        }

        return false;
    }

    private static bool GetBool(
        JsonElement obj,
        string name,
        bool fallback)
    {
        if (!obj.TryGetProperty(name, out var value))
            return fallback;

        if (value.ValueKind == JsonValueKind.True)
            return true;

        if (value.ValueKind == JsonValueKind.False)
            return false;

        if (value.ValueKind == JsonValueKind.Number &&
            value.TryGetInt32(out var number))
        {
            return number != 0;
        }

        if (value.ValueKind == JsonValueKind.String)
        {
            var raw =
                (value.GetString() ?? string.Empty)
                .Trim()
                .ToLowerInvariant();

            if (raw == "true" ||
                raw == "1" ||
                raw == "yes" ||
                raw == "y")
            {
                return true;
            }

            if (raw == "false" ||
                raw == "0" ||
                raw == "no" ||
                raw == "n")
            {
                return false;
            }
        }

        return fallback;
    }

    public enum MouseButton
    {
        Left = 0,
        Right = 1,
        Middle = 2,
        X1 = 3,
        X2 = 4
    }

    public abstract record ControlMessage
    {
        public sealed record MouseMoveNormalized(
            double X,
            double Y) : ControlMessage;

        public sealed record MouseButtonNormalized(
            bool IsDown,
            RemoteConsoleControlProtocol.MouseButton Button,
            double? X,
            double? Y) : ControlMessage;

        public sealed record BrowserMouseWheel(
            double Dx,
            double Dy,
            string Mode) : ControlMessage;

        public sealed record ReleaseModifiers : ControlMessage;

        public sealed record MouseMoveAbs(
            int X,
            int Y) : ControlMessage;

        public sealed record MouseMoveRel(
            int Dx,
            int Dy) : ControlMessage;

        public sealed record MouseButton(
            bool IsDown,
            RemoteConsoleControlProtocol.MouseButton Button) : ControlMessage;

        public sealed record MouseWheel(
            bool Vertical,
            int Delta) : ControlMessage;

        public sealed record Key(
            bool IsDown,
            int Vk,
            string? KeyName) : ControlMessage;

        public sealed record Text(
            string TextValue) : ControlMessage;

        public sealed record Sync(
            bool Caps,
            bool Num,
            bool Scroll) : ControlMessage;
    }
}