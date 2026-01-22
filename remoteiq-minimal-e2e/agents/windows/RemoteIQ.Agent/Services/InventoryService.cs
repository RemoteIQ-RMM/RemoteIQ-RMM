using System.Net.Http.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class InventoryService : BackgroundService
{
    private readonly ConfigService _cfg;
    private readonly PinnedHttpClientFactory _httpFactory;
    private readonly SystemInfoCollector _sys;
    private readonly ILogger<InventoryService> _log;

    public InventoryService(ConfigService cfg, PinnedHttpClientFactory httpFactory, SystemInfoCollector sys, ILogger<InventoryService> log)
    {
        _cfg = cfg; _httpFactory = httpFactory; _sys = sys; _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrEmpty(_cfg.Current.AgentId) || string.IsNullOrEmpty(_cfg.Current.AgentKey))
                {
                    await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
                    continue;
                }

                var items = _sys.CollectInstalledSoftwareItems();
                if (items.Count == 0)
                {
                    await Task.Delay(TimeSpan.FromMinutes(_cfg.Current.PollIntervals.InventoryMinutes), stoppingToken);
                    continue;
                }

                var http = _httpFactory.Create();
                var url = $"{_cfg.Current.ApiBaseUrl.TrimEnd('/')}/api/agent/software";
                using var req = new HttpRequestMessage(HttpMethod.Post, url);
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _cfg.Current.AgentKey);

                req.Content = JsonContent.Create(new { items });

                var resp = await http.SendAsync(req, stoppingToken);
                resp.EnsureSuccessStatusCode();

                _log.LogInformation("Software inventory sent: {Count}", items.Count);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Software inventory send failed");
            }

            await Task.Delay(TimeSpan.FromMinutes(_cfg.Current.PollIntervals.InventoryMinutes), stoppingToken);
        }
    }
}
