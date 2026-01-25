// RemoteIQ.Agent/Services/SystemInfoCollector.cs

using System.Globalization;
using System.Management;
using Microsoft.Win32;

namespace RemoteIQ.Agent.Services;

public sealed class SystemInfoCollector
{
    // Kept for compatibility if anything calls Collect()
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
            ["disks"] = WmiMulti("Win32_LogicalDisk", "DeviceID,FileSystem,Size,FreeSpace")
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

                // Some installers use YYYYMMDD
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

    // ✅ NEW: Collect the facts object for the dashboard device summary page
    // Designed to be safe + small (no giant WMI dumps).
    public Task<DeviceFacts> CollectDeviceFactsAsync(CancellationToken ct)
    {
        // WMI can block; wrap in Task.Run so we don't stall the worker loop.
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
            // Model: Manufacturer + Model (fallback to just Model)
            var manufacturer = Try(() => WmiSingle("Win32_ComputerSystem", "Manufacturer")?.ToString(), "") ?? "";
            var modelOnly = Try(() => WmiSingle("Win32_ComputerSystem", "Model")?.ToString(), "") ?? "";
            var model = string.Join(" ", new[] { manufacturer.Trim(), modelOnly.Trim() }.Where(s => !string.IsNullOrWhiteSpace(s))).Trim();
            if (string.IsNullOrWhiteSpace(model)) model = null;

            // CPU: use first processor
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

            // RAM bytes (total physical memory)
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
            var serial = Try(() => WmiSingle("Win32_BIOS", "SerialNumber")?.ToString(), "")?.Trim();
            if (string.IsNullOrWhiteSpace(serial)) serial = null;

            // GPUs (unique)
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

    private static List<DiskFacts> CollectDiskFactsSafe()
    {
        var list = new List<DiskFacts>();

        // Prefer DriveInfo (fast + reliable for fixed disks)
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

                var summary = (total > 0 && free >= 0)
                    ? $"{BytesToPretty(free)} free of {BytesToPretty(total)}"
                    : null;

                list.Add(new DiskFacts
                {
                    Mount = mount,
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

        // If DriveInfo returns nothing (rare), fallback to WMI logical disks
        if (list.Count == 0)
        {
            try
            {
                var rows = WmiMulti("Win32_LogicalDisk", "DeviceID,FileSystem,Size,FreeSpace");
                foreach (var row in rows)
                {
                    var deviceId = row.TryGetValue("DeviceID", out var dev) ? dev?.ToString() : null;
                    var fs = row.TryGetValue("FileSystem", out var fsv) ? fsv?.ToString() : null;

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

                    if (!string.IsNullOrWhiteSpace(deviceId))
                    {
                        list.Add(new DiskFacts
                        {
                            Mount = deviceId!.Trim(),
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

        // Common: YYYYMMDD
        if (s.Length == 8 && s.All(char.IsDigit))
        {
            var yyyy = s.Substring(0, 4);
            var mm = s.Substring(4, 2);
            var dd = s.Substring(6, 2);
            return $"{yyyy}-{mm}-{dd}";
        }

        // Try parse anything else safely
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
}
