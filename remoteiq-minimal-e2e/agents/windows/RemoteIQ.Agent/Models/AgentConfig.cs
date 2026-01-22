namespace RemoteIQ.Agent.Models;

public sealed class AgentConfig
{
    public string ApiBaseUrl { get; set; } = "";

    // Returned by backend enrollment (/api/agent/enroll)
    public string AgentId { get; set; } = "";

    // AgentKey == agentToken (opaque) used as Bearer token to backend
    public string AgentKey { get; set; } = "";

    // Required to enroll (installer should set these before first start)
    public string DeviceId { get; set; } = "";
    public string EnrollmentSecret { get; set; } = "";

    public string AgentGroup { get; set; } = "default";

    public PollIntervals PollIntervals { get; set; } = new();
    public SecurityConfig Security { get; set; } = new();
}

public sealed class PollIntervals
{
    public int HeartbeatSeconds { get; set; } = 30;
    public int TaskPollSeconds { get; set; } = 5; // not used now (WS-based jobs), kept for compatibility
    public int InventoryMinutes { get; set; } = 30;
    public int UpdateCheckMinutes { get; set; } = 30;
}

public sealed class SecurityConfig
{
    public bool RequireSignedTasks { get; set; } = true;
    public string RsaPublicKeyPem { get; set; } = "";
    public bool EnableCertPinning { get; set; } = false;
    public string[] PinnedSpkiSha256 { get; set; } = System.Array.Empty<string>();
}
