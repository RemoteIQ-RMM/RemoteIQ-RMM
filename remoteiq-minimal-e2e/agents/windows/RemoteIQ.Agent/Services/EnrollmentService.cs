using System.Net.Http.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RemoteIQ.Agent.Models;

namespace RemoteIQ.Agent.Services;

public sealed class EnrollmentService : BackgroundService
{
    private readonly ConfigService _config;
    private readonly PinnedHttpClientFactory _httpFactory;
    private readonly ILogger<EnrollmentService> _log;

    public EnrollmentService(ConfigService cfg, PinnedHttpClientFactory http, ILogger<EnrollmentService> log)
    {
        _config = cfg; _httpFactory = http; _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (!string.IsNullOrEmpty(_config.Current.AgentId) && !string.IsNullOrEmpty(_config.Current.AgentKey))
                return;

            // Must have these to enroll
            if (string.IsNullOrWhiteSpace(_config.Current.DeviceId) || string.IsNullOrWhiteSpace(_config.Current.EnrollmentSecret))
            {
                _log.LogError("Agent not enrolled and missing DeviceId and/or EnrollmentSecret in config. Waiting.");
                await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
                continue;
            }

            var http = _httpFactory.Create();
            try
            {
                var body = new EnrollmentRequest
                {
                    EnrollmentSecret = _config.Current.EnrollmentSecret,
                    DeviceId = _config.Current.DeviceId,
                    Hostname = Environment.MachineName,
                    Os = "windows",
                    Arch = Environment.Is64BitOperatingSystem ? "x64" : "x86",
                    Version = "1.0.0"
                };


                var url = $"{_config.Current.ApiBaseUrl.TrimEnd('/')}/api/agent/enroll";
                var resp = await http.PostAsJsonAsync(url, body, stoppingToken);
                resp.EnsureSuccessStatusCode();

                var er = await resp.Content.ReadFromJsonAsync<EnrollmentResponse>(cancellationToken: stoppingToken)
                         ?? throw new InvalidOperationException("Empty enrollment response");

                if (string.IsNullOrWhiteSpace(er.AgentId) || string.IsNullOrWhiteSpace(er.AgentToken))
                    throw new InvalidOperationException("Enrollment response missing agentId or agentToken");

                _config.Current.AgentId = er.AgentId;
                _config.Current.AgentKey = er.AgentToken;

                // keep device id aligned with backend
                if (!string.IsNullOrWhiteSpace(er.DeviceId))
                    _config.Current.DeviceId = er.DeviceId;

                // important: clear enrollment secret after successful enrollment
                _config.Current.EnrollmentSecret = "";

                _config.Save(_config.Current);

                _log.LogInformation("Enrollment successful: {AgentId}", er.AgentId);
                return;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Enrollment failed; retry in 2 minutes");
                await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
            }
        }
    }
}
