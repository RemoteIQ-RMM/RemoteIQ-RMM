// RemoteIQ.Agent/Services/DeviceFacts.cs

namespace RemoteIQ.Agent.Services;

public sealed class DeviceFacts
{
    public HardwareFacts? Hardware { get; set; }
    public List<DiskFacts>? Disks { get; set; }
}

public sealed class HardwareFacts
{
    public string? Model { get; set; }
    public string? Cpu { get; set; }

    // Accurate + UI-friendly
    public long? RamBytes { get; set; }
    public string? Ram { get; set; }

    // Some machines have multiple adapters
    public List<string>? Gpu { get; set; }

    public string? Serial { get; set; }
}

public sealed class DiskFacts
{
    public string? Mount { get; set; }     // "C:" or "/"
    public string? Name { get; set; }      // optional
    public string? Fs { get; set; }        // "NTFS"
    public long? TotalBytes { get; set; }
    public long? FreeBytes { get; set; }

    // Optional, UI can compute if needed
    public long? UsedBytes { get; set; }
    public double? UsedPercent { get; set; }

    // Optional pretty string: "2.9 TB free of 7.3 TB"
    public string? Summary { get; set; }
}
