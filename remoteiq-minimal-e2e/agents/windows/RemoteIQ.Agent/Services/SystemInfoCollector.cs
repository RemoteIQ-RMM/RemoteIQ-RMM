using System.Management;
using Microsoft.Win32;
using System.Globalization;

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

        string[] roots = {
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
            var mo = (ManagementObject)o;
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
            var mo = (ManagementObject)o;
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
