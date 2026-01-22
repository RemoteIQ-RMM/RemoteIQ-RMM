using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using RemoteIQ.Agent.Models;

namespace RemoteIQ.Agent.Services;

public sealed class ConfigService
{
    private readonly IConfiguration _cfg;
    private readonly ILogger<ConfigService> _log;

    private readonly string _configPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "RemoteIQ", "agent.config.json");

    public AgentConfig Current { get; private set; }

    public ConfigService(IConfiguration cfg, ILogger<ConfigService> log)
    {
        _cfg = cfg;
        _log = log;

        Directory.CreateDirectory(Path.GetDirectoryName(_configPath)!);

        var defaults = new AgentConfig();
        _cfg.GetSection("RemoteIQ").Bind(defaults);

        Current = LoadOrInit(defaults);
    }

    private AgentConfig LoadOrInit(AgentConfig defaults)
    {
        if (!File.Exists(_configPath))
        {
            Save(defaults);
            return defaults;
        }

        var json = File.ReadAllText(_configPath, Encoding.UTF8);
        var cfg = System.Text.Json.JsonSerializer.Deserialize<AgentConfig>(json) ?? defaults;

        // DPAPI decrypt helpers
        cfg.AgentKey = TryDpapiUnprotect(cfg.AgentKey, "AgentKey");
        cfg.EnrollmentSecret = TryDpapiUnprotect(cfg.EnrollmentSecret, "EnrollmentSecret");

        return cfg;
    }

    private string TryDpapiUnprotect(string value, string label)
    {
        if (string.IsNullOrEmpty(value)) return "";

        if (!value.StartsWith("DPAPI:", StringComparison.Ordinal))
            return value;

        try
        {
            var b64 = value.Substring("DPAPI:".Length);
            var enc = Convert.FromBase64String(b64);
            var clear = ProtectedData.Unprotect(enc, null, DataProtectionScope.LocalMachine);
            return Encoding.UTF8.GetString(clear);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to decrypt {Label}; value will be cleared.", label);
            return "";
        }
    }

    private string ProtectIfNotEmpty(string clearText)
    {
        if (string.IsNullOrEmpty(clearText)) return "";
        var clear = Encoding.UTF8.GetBytes(clearText);
        var enc = ProtectedData.Protect(clear, null, DataProtectionScope.LocalMachine);
        return "DPAPI:" + Convert.ToBase64String(enc);
    }

    public void Save(AgentConfig cfg)
    {
        // Store only DPAPI-wrapped sensitive fields
        var toStore = new AgentConfig
        {
            ApiBaseUrl = cfg.ApiBaseUrl,
            AgentId = cfg.AgentId,
            AgentGroup = cfg.AgentGroup,
            DeviceId = cfg.DeviceId,

            PollIntervals = cfg.PollIntervals,
            Security = cfg.Security,

            AgentKey = ProtectIfNotEmpty(cfg.AgentKey),
            EnrollmentSecret = ProtectIfNotEmpty(cfg.EnrollmentSecret),
        };

        var json = System.Text.Json.JsonSerializer.Serialize(toStore, new System.Text.Json.JsonSerializerOptions
        {
            WriteIndented = true
        });

        File.WriteAllText(_configPath, json, Encoding.UTF8);
        Current = cfg;
    }
}
