namespace RemoteIQ.Agent.Models;

public sealed class EnrollmentRequest
{
    public string EnrollmentSecret { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string Hostname { get; set; } = "";
    public string Os { get; set; } = "windows";
    public string Arch { get; set; } = "x64";
    public string Version { get; set; } = "1.0.0";
}

public sealed class EnrollmentResponse
{
    public string AgentId { get; set; } = "";
    public string AgentToken { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string? AgentUuid { get; set; } = null;
}
