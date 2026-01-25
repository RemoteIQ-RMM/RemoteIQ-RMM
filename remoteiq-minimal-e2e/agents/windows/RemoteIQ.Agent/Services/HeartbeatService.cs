// RemoteIQ.Agent/Services/HeartbeatService.cs

using System.Net.Http.Json;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class HeartbeatService : BackgroundService
{
    private readonly ConfigService _cfg;
    private readonly PinnedHttpClientFactory _httpFactory;
    private readonly SystemInfoCollector _sys;
    private readonly ILogger<HeartbeatService> _log;

    // Facts are not changing every minute; refresh periodically.
    private DateTimeOffset _factsLastCollected = DateTimeOffset.MinValue;
    private DeviceFacts? _factsCache;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    public HeartbeatService(
        ConfigService cfg,
        PinnedHttpClientFactory httpFactory,
        SystemInfoCollector sys,
        ILogger<HeartbeatService> log)
    {
        _cfg = cfg;
        _httpFactory = httpFactory;
        _sys = sys;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrEmpty(_cfg.Current.AgentId) || string.IsNullOrEmpty(_cfg.Current.AgentKey))
                {
                    await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                    continue;
                }

                // Refresh cached facts every 6 hours
                if (_factsCache is null || (DateTimeOffset.UtcNow - _factsLastCollected) > TimeSpan.FromHours(6))
                {
                    _factsCache = await _sys.CollectDeviceFactsAsync(stoppingToken);
                    _factsLastCollected = DateTimeOffset.UtcNow;

                    // Safety cap: avoid sending overly large facts payloads
                    var factsJson = JsonSerializer.Serialize(_factsCache, JsonOpts);
                    if (factsJson.Length > 64 * 1024)
                    {
                        _log.LogWarning("Facts payload too large ({Len} chars). Skipping facts for this cycle.", factsJson.Length);
                        _factsCache = null;
                    }
                }

                var http = _httpFactory.Create();
                var url = $"{_cfg.Current.ApiBaseUrl.TrimEnd('/')}/api/agent/ping";

                using var req = new HttpRequestMessage(HttpMethod.Post, url);
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _cfg.Current.AgentKey);

                var payload = new
                {
                    os = "windows",
                    arch = Environment.Is64BitOperatingSystem ? "x64" : "x86",
                    version = typeof(HeartbeatService).Assembly.GetName().Version?.ToString() ?? "1.0.0",
                    primaryIp = GetPrimaryIpv4(),
                    user = Environment.UserName,

                    // ✅ NEW: device summary facts
                    facts = _factsCache
                };

                req.Content = JsonContent.Create(payload, options: JsonOpts);

                var resp = await http.SendAsync(req, stoppingToken);
                resp.EnsureSuccessStatusCode();
            }
            catch (Exception ex)
            {
                _log.LogDebugThrottled("hb", TimeSpan.FromMinutes(1), "Heartbeat error: {Msg}", ex.Message);
            }

            await Task.Delay(TimeSpan.FromSeconds(_cfg.Current.PollIntervals.HeartbeatSeconds), stoppingToken);
        }
    }

    private static string? GetPrimaryIpv4()
    {
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

                var props = ni.GetIPProperties();
                foreach (var ua in props.UnicastAddresses)
                {
                    if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    var ip = ua.Address.ToString();
                    if (ip.StartsWith("169.254.")) continue; // APIPA
                    return ip;
                }
            }
        }
        catch
        {
            // ignore
        }

        return null;
    }
}
