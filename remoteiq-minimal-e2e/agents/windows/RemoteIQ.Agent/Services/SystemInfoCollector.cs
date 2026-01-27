// RemoteIQ.Agent/Services/SystemInfoCollector.cs

using System.Globalization;
using System.Management;
using Microsoft.Win32;
using System.Runtime.InteropServices;

namespace RemoteIQ.Agent.Services;

public sealed class SystemInfoCollector
{
    // ---------------- Kept for compatibility ----------------

    public Dictionary<string, object> Collect()
    {
        var info = new Dictionary<string, object>
        {
            ["hostname"] = Environment.MachineName,
            ["username"] = Environment.UserName,
            ["osVersion"] = Environment.OSVersion.ToString(),
            ["architecture"] = Environment.Is64BitOperatingSystem ? "x64" : "x86",
            ["dotnetRuntime"] = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
        };

        info["hardware"] = new Dictionary<string, object>
        {
            ["cpu"] = WmiMulti("Win32_Processor", "Name,NumberOfCores,NumberOfLogicalProcessors"),
            ["memoryBytes"] = Try(() => Convert.ToUInt64(WmiSingle("Win32_ComputerSystem", "TotalPhysicalMemory")), 0UL),
            ["disks"] = WmiMulti("Win32_LogicalDisk", "DeviceID,FileSystem,Size,FreeSpace,VolumeName")
        };

        info["nics"] = WmiMulti("Win32_NetworkAdapterConfiguration", "Description,MACAddress,IPAddress");
        info["software"] = CollectInstalledSoftwareItems();

        return info;
    }

    public List<object> CollectInstalledSoftwareItems()
    {
        var result = new List<object>();

        string[] roots =
        {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
        };

        foreach (var root in roots)
        {
            using var key = Registry.LocalMachine.OpenSubKey(root);
            if (key is null) continue;

            foreach (var sub in key.GetSubKeyNames())
            {
                using var sk = key.OpenSubKey(sub);
                if (sk is null) continue;

                var name = sk.GetValue("DisplayName")?.ToString();
                if (string.IsNullOrWhiteSpace(name)) continue;

                var version = sk.GetValue("DisplayVersion")?.ToString();
                var publisher = sk.GetValue("Publisher")?.ToString();

                var installDateRaw = sk.GetValue("InstallDate")?.ToString();
                var installDate = NormalizeInstallDate(installDateRaw);

                result.Add(new
                {
                    name = name!.Trim(),
                    version = string.IsNullOrWhiteSpace(version) ? null : version.Trim(),
                    publisher = string.IsNullOrWhiteSpace(publisher) ? null : publisher.Trim(),
                    installDate = installDate, // YYYY-MM-DD or null
                });
            }
        }

        return result;
    }

    // ---------------- Facts used by dashboard summary ----------------

    public Task<DeviceFacts> CollectDeviceFactsAsync(CancellationToken ct)
    {
        return Task.Run(() =>
        {
            ct.ThrowIfCancellationRequested();

            var facts = new DeviceFacts
            {
                Hardware = CollectHardwareFactsSafe(),
                Disks = CollectDiskFactsSafe()
            };

            return facts;
        }, ct);
    }

    private static HardwareFacts CollectHardwareFactsSafe()
    {
        try
        {
            var manufacturer = (Try(() => WmiSingle("Win32_ComputerSystem", "Manufacturer")?.ToString(), "") ?? "").Trim();

            var modelCsp = (Try(() => WmiSingle("Win32_ComputerSystemProduct", "Name")?.ToString(), "") ?? "").Trim();
            var modelCs = (Try(() => WmiSingle("Win32_ComputerSystem", "Model")?.ToString(), "") ?? "").Trim();
            var boardProduct = (Try(() => WmiSingle("Win32_BaseBoard", "Product")?.ToString(), "") ?? "").Trim();

            string? modelOnly =
                !IsPlaceholder(modelCsp) ? modelCsp :
                !IsPlaceholder(modelCs) ? modelCs :
                !IsPlaceholder(boardProduct) ? boardProduct :
                null;

            var model = string.Join(" ", new[] { manufacturer, modelOnly }.Where(s => !string.IsNullOrWhiteSpace(s))).Trim();
            if (string.IsNullOrWhiteSpace(model)) model = null;

            // CPU
            var cpuName = "";
            int? cores = null;
            int? threads = null;

            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT Name,NumberOfCores,NumberOfLogicalProcessors FROM Win32_Processor");
                foreach (var o in searcher.Get())
                {
                    using var mo = (ManagementObject)o;
                    cpuName = (mo["Name"]?.ToString() ?? "").Trim();

                    if (mo["NumberOfCores"] is uint uc) cores = (int)uc;
                    else if (mo["NumberOfCores"] is int ic) cores = ic;

                    if (mo["NumberOfLogicalProcessors"] is uint ut) threads = (int)ut;
                    else if (mo["NumberOfLogicalProcessors"] is int it) threads = it;

                    break;
                }
            }
            catch
            {
                // ignore
            }

            var cpu = !string.IsNullOrWhiteSpace(cpuName)
                ? (cores.HasValue && threads.HasValue ? $"{cpuName}, {cores.Value}C/{threads.Value}T" : cpuName)
                : null;

            // RAM bytes
            long? ramBytes = null;
            try
            {
                var raw = WmiSingle("Win32_ComputerSystem", "TotalPhysicalMemory");
                if (raw is null) ramBytes = null;
                else if (raw is ulong u) ramBytes = checked((long)u);
                else if (raw is long l) ramBytes = l;
                else if (long.TryParse(raw.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)) ramBytes = parsed;
            }
            catch
            {
                // ignore
            }

            // Serial
            var cspSerial = (Try(() => WmiSingle("Win32_ComputerSystemProduct", "IdentifyingNumber")?.ToString(), "") ?? "").Trim();
            var biosSerial = (Try(() => WmiSingle("Win32_BIOS", "SerialNumber")?.ToString(), "") ?? "").Trim();
            var bbSerial = (Try(() => WmiSingle("Win32_BaseBoard", "SerialNumber")?.ToString(), "") ?? "").Trim();

            string? serial =
                !IsPlaceholder(cspSerial) ? cspSerial :
                !IsPlaceholder(biosSerial) ? biosSerial :
                !IsPlaceholder(bbSerial) ? bbSerial :
                null;

            // GPUs
            var gpus = new List<string>();
            try
            {
                using var searcher = new ManagementObjectSearcher("SELECT Name FROM Win32_VideoController");
                foreach (var o in searcher.Get())
                {
                    using var mo = (ManagementObject)o;
                    var name = (mo["Name"]?.ToString() ?? "").Trim();
                    if (!string.IsNullOrWhiteSpace(name)) gpus.Add(name);
                }
            }
            catch
            {
                // ignore
            }

            gpus = gpus
                .Select(s => s.Trim())
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            return new HardwareFacts
            {
                Model = model,
                Cpu = cpu,
                RamBytes = ramBytes,
                Ram = ramBytes.HasValue ? $"{BytesToPretty(ramBytes.Value)} RAM" : null,
                Gpu = gpus.Count > 0 ? gpus : null,
                Serial = serial
            };
        }
        catch
        {
            return new HardwareFacts();
        }
    }

    private static bool IsPlaceholder(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return true;
        var v = s.Trim();

        if (v.Equals("System Product Name", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("System Serial Number", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("To be filled by O.E.M.", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("Default string", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("None", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("N/A", StringComparison.OrdinalIgnoreCase)) return true;

        return false;
    }

    private static List<DiskFacts> CollectDiskFactsSafe()
    {
        var list = new List<DiskFacts>();

        // Prefer DriveInfo
        try
        {
            foreach (var d in DriveInfo.GetDrives())
            {
                if (d.DriveType != DriveType.Fixed) continue;
                if (!d.IsReady) continue;

                var total = d.TotalSize;
                var free = d.AvailableFreeSpace;
                var used = (total > 0 && free >= 0) ? total - free : (long?)null;

                double? usedPct = null;
                if (total > 0 && used.HasValue)
                {
                    usedPct = (double)used.Value / total * 100.0;
                    if (usedPct < 0) usedPct = 0;
                    if (usedPct > 100) usedPct = 100;
                }

                var mount = d.Name.TrimEnd('\\'); // "C:\\" -> "C:"
                var fs = Try(() => d.DriveFormat, "")?.Trim();
                if (string.IsNullOrWhiteSpace(fs)) fs = null;

                string? name = null;
                try
                {
                    var label = d.VolumeLabel?.Trim();
                    if (!string.IsNullOrWhiteSpace(label)) name = label;
                }
                catch
                {
                    // ignore
                }

                var summary = (total > 0 && free >= 0)
                    ? $"{BytesToPretty(free)} free of {BytesToPretty(total)}"
                    : null;

                list.Add(new DiskFacts
                {
                    Mount = mount,
                    Name = name,
                    Fs = fs,
                    TotalBytes = total > 0 ? total : null,
                    FreeBytes = free >= 0 ? free : null,
                    UsedBytes = used,
                    UsedPercent = usedPct,
                    Summary = summary
                });
            }
        }
        catch
        {
            // ignore
        }

        // Fallback: WMI logical disks
        if (list.Count == 0)
        {
            try
            {
                var rows = WmiMulti("Win32_LogicalDisk", "DeviceID,FileSystem,Size,FreeSpace,VolumeName");
                foreach (var row in rows)
                {
                    var deviceId = row.TryGetValue("DeviceID", out var dev) ? dev?.ToString() : null;
                    var fs = row.TryGetValue("FileSystem", out var fsv) ? fsv?.ToString() : null;
                    var vol = row.TryGetValue("VolumeName", out var vv) ? vv?.ToString() : null;

                    var size = ParseLong(row.TryGetValue("Size", out var sv) ? sv : null);
                    var free = ParseLong(row.TryGetValue("FreeSpace", out var fv) ? fv : null);

                    long? used = null;
                    double? usedPct = null;
                    if (size.HasValue && free.HasValue && size.Value > 0)
                    {
                        used = size.Value - free.Value;
                        usedPct = (double)used.Value / size.Value * 100.0;
                        if (usedPct < 0) usedPct = 0;
                        if (usedPct > 100) usedPct = 100;
                    }

                    var summary = (size.HasValue && free.HasValue && size.Value > 0)
                        ? $"{BytesToPretty(free.Value)} free of {BytesToPretty(size.Value)}"
                        : null;

                    var name = string.IsNullOrWhiteSpace(vol) ? null : vol.Trim();

                    if (!string.IsNullOrWhiteSpace(deviceId))
                    {
                        list.Add(new DiskFacts
                        {
                            Mount = deviceId!.Trim(),
                            Name = name,
                            Fs = string.IsNullOrWhiteSpace(fs) ? null : fs.Trim(),
                            TotalBytes = size,
                            FreeBytes = free,
                            UsedBytes = used,
                            UsedPercent = usedPct,
                            Summary = summary
                        });
                    }
                }
            }
            catch
            {
                // ignore
            }
        }

        return list
            .OrderBy(d => d.Mount, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static long? ParseLong(object? v)
    {
        if (v is null) return null;
        if (v is long l) return l;
        if (v is ulong u) return checked((long)u);
        if (v is int i) return i;
        if (v is uint ui) return ui;

        var s = v.ToString();
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (long.TryParse(s.Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)) return parsed;
        return null;
    }

    private static string BytesToPretty(long bytes)
    {
        if (bytes < 0) return "—";
        if (bytes == 0) return "0 B";

        var units = new[] { "B", "KB", "MB", "GB", "TB", "PB" };
        var b = (double)bytes;
        var i = (int)Math.Floor(Math.Log(b, 1024));
        if (i < 0) i = 0;
        if (i > units.Length - 1) i = units.Length - 1;

        var v = b / Math.Pow(1024, i);
        var dec = i == 0 ? 0 : 1;
        return v.ToString($"N{dec}", CultureInfo.InvariantCulture) + " " + units[i];
    }

    private static string? NormalizeInstallDate(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var s = raw.Trim();

        if (s.Length == 8 && s.All(char.IsDigit))
        {
            var yyyy = s.Substring(0, 4);
            var mm = s.Substring(4, 2);
            var dd = s.Substring(6, 2);
            return $"{yyyy}-{mm}-{dd}";
        }

        if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
        {
            return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        return null;
    }

    private static object WmiSingle(string cls, string prop)
    {
        using var searcher = new ManagementObjectSearcher($"SELECT {prop} FROM {cls}");
        foreach (var o in searcher.Get())
        {
            using var mo = (ManagementObject)o;
            return mo[prop] ?? "";
        }
        return "";
    }

    private static List<Dictionary<string, object>> WmiMulti(string cls, string propsCsv)
    {
        var props = propsCsv.Split(',').Select(s => s.Trim()).ToArray();
        var list = new List<Dictionary<string, object>>();

        using var searcher = new ManagementObjectSearcher($"SELECT {propsCsv} FROM {cls}");
        foreach (var o in searcher.Get())
        {
            using var mo = (ManagementObject)o;
            var row = new Dictionary<string, object>();
            foreach (var p in props)
            {
                var val = mo[p];
                if (val is Array arr) row[p] = string.Join(",", arr.Cast<object>());
                else row[p] = val ?? "";
            }
            list.Add(row);
        }
        return list;
    }

    private static T Try<T>(Func<T> f, T fallback) { try { return f(); } catch { return fallback; } }

    // ---------------- Interactive user detection (WTS + WMI) ----------------

    public sealed record InteractiveUserProbe(
        uint ActiveSessionId,
        string? WtsUser,
        string? WtsDomain,
        string? WmiUser,
        string? ResultUser
    );

    // For HeartbeatService payload
    public static string? GetInteractiveUserSafe()
    {
        return GetInteractiveUserProbeSafe().ResultUser;
    }

    // For logging/debugging (exactly what each source returns)
    public static InteractiveUserProbe GetInteractiveUserProbeSafe()
    {
        uint sessionId = 0xFFFFFFFF;
        string? wtsUser = null;
        string? wtsDomain = null;
        string? wmiUser = null;
        string? result = null;

        // 1) WTS active console session
        try
        {
            sessionId = WTSGetActiveConsoleSessionId();
            if (sessionId != 0xFFFFFFFF)
            {
                wtsUser = WtsQueryString(sessionId, WTS_INFO_CLASS.WTSUserName);
                wtsDomain = WtsQueryString(sessionId, WTS_INFO_CLASS.WTSDomainName);

                result = NormalizeUser(wtsDomain, wtsUser);
            }
        }
        catch
        {
            // ignore
        }

        // 1b) If console session didn’t give a real user, enumerate sessions and find an Active one
        if (string.IsNullOrWhiteSpace(result))
        {
            try
            {
                var fromEnum = TryFindActiveSessionUserFromEnumeration();
                if (!string.IsNullOrWhiteSpace(fromEnum.ResultUser))
                {
                    sessionId = fromEnum.ActiveSessionId;
                    wtsUser = fromEnum.WtsUser;
                    wtsDomain = fromEnum.WtsDomain;
                    result = fromEnum.ResultUser;
                }
            }
            catch
            {
                // ignore
            }
        }

        // 2) WMI fallback: Win32_ComputerSystem.UserName
        try
        {
            var raw = WmiSingle("Win32_ComputerSystem", "UserName")?.ToString();
            if (!string.IsNullOrWhiteSpace(raw))
            {
                wmiUser = raw.Trim();
                if (!IsGarbageIdentity(wmiUser))
                {
                    result = wmiUser;
                }
            }
        }
        catch
        {
            // ignore
        }

        // 3) Return null if unknown (HeartbeatService will send "" to clear backend)
        if (string.IsNullOrWhiteSpace(result)) result = null;

        return new InteractiveUserProbe(
            ActiveSessionId: sessionId,
            WtsUser: wtsUser,
            WtsDomain: wtsDomain,
            WmiUser: wmiUser,
            ResultUser: result
        );
    }

    private static InteractiveUserProbe TryFindActiveSessionUserFromEnumeration()
    {
        IntPtr ppSessionInfo = IntPtr.Zero;
        int count = 0;

        try
        {
            if (!WTSEnumerateSessions(WTS_CURRENT_SERVER_HANDLE, 0, 1, out ppSessionInfo, out count))
                return new InteractiveUserProbe(0xFFFFFFFF, null, null, null, null);

            int dataSize = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
            long current = ppSessionInfo.ToInt64();

            for (int i = 0; i < count; i++)
            {
                var si = Marshal.PtrToStructure<WTS_SESSION_INFO>(new IntPtr(current));
                current += dataSize;

                if (si.State != WTS_CONNECTSTATE_CLASS.WTSActive) continue;

                var user = WtsQueryString((uint)si.SessionID, WTS_INFO_CLASS.WTSUserName);
                var dom = WtsQueryString((uint)si.SessionID, WTS_INFO_CLASS.WTSDomainName);

                var normalized = NormalizeUser(dom, user);
                if (!string.IsNullOrWhiteSpace(normalized))
                {
                    return new InteractiveUserProbe((uint)si.SessionID, user, dom, null, normalized);
                }
            }
        }
        finally
        {
            if (ppSessionInfo != IntPtr.Zero)
                WTSFreeMemory(ppSessionInfo);
        }

        return new InteractiveUserProbe(0xFFFFFFFF, null, null, null, null);
    }

    private static string? NormalizeUser(string? domain, string? user)
    {
        user = string.IsNullOrWhiteSpace(user) ? null : user.Trim();
        domain = string.IsNullOrWhiteSpace(domain) ? null : domain.Trim();

        if (string.IsNullOrWhiteSpace(user)) return null;

        // ignore service/machine identities
        var merged = !string.IsNullOrWhiteSpace(domain) ? $"{domain}\\{user}" : user;
        if (IsGarbageIdentity(merged)) return null;

        return merged;
    }

    private static bool IsGarbageIdentity(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return true;
        var v = s.Trim();

        // machine account like COMPUTER$
        if (v.EndsWith("$", StringComparison.OrdinalIgnoreCase)) return true;

        // common service identities
        if (v.Equals("SYSTEM", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("NT AUTHORITY\\SYSTEM", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("LOCAL SERVICE", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("NT AUTHORITY\\LOCAL SERVICE", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("NETWORK SERVICE", StringComparison.OrdinalIgnoreCase)) return true;
        if (v.Equals("NT AUTHORITY\\NETWORK SERVICE", StringComparison.OrdinalIgnoreCase)) return true;

        return false;
    }

    // ---------------- WTS helpers ----------------

    private enum WTS_INFO_CLASS
    {
        WTSUserName = 5,
        WTSDomainName = 7,
    }

    private enum WTS_CONNECTSTATE_CLASS
    {
        WTSActive = 0,
        WTSConnected = 1,
        WTSConnectQuery = 2,
        WTSShadow = 3,
        WTSDisconnected = 4,
        WTSIdle = 5,
        WTSListen = 6,
        WTSReset = 7,
        WTSDown = 8,
        WTSInit = 9
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WTS_SESSION_INFO
    {
        public int SessionID;

        [MarshalAs(UnmanagedType.LPStr)]
        public string pWinStationName;

        public WTS_CONNECTSTATE_CLASS State;
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

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSEnumerateSessions(
        IntPtr hServer,
        int Reserved,
        int Version,
        out IntPtr ppSessionInfo,
        out int pCount);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr pMemory);

    private static readonly IntPtr WTS_CURRENT_SERVER_HANDLE = IntPtr.Zero;

    private static string? WtsQueryString(uint sessionId, WTS_INFO_CLASS cls)
    {
        IntPtr buffer = IntPtr.Zero;
        uint bytes = 0;

        try
        {
            if (!WTSQuerySessionInformation(WTS_CURRENT_SERVER_HANDLE, sessionId, cls, out buffer, out bytes))
                return null;

            if (buffer == IntPtr.Zero || bytes <= 2)
                return null;

            var s = Marshal.PtrToStringUni(buffer);
            return string.IsNullOrWhiteSpace(s) ? null : s;
        }
        finally
        {
            if (buffer != IntPtr.Zero)
                WTSFreeMemory(buffer);
        }
    }
}
