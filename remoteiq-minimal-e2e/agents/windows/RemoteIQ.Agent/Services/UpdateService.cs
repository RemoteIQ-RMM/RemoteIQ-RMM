//remoteiq-minimal-e2e\agents\windows\RemoteIQ.Agent\Services\UpdateService.cs

using System.Net.Http.Json;
using System.Security.Cryptography;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RemoteIQ.Agent.Models;

namespace RemoteIQ.Agent.Services;

public sealed class UpdateService : BackgroundService
{
    private readonly ConfigService _cfg;
    private readonly PinnedHttpClientFactory _httpFactory;
    private readonly CryptoService _crypto;
    private readonly ILogger<UpdateService> _log;

    public UpdateService(ConfigService cfg, PinnedHttpClientFactory httpFactory, CryptoService crypto, ILogger<UpdateService> log)
    {
        _cfg = cfg; _httpFactory = httpFactory; _crypto = crypto; _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrEmpty(_cfg.Current.AgentId) || string.IsNullOrEmpty(_cfg.Current.AgentKey))
                {
                    await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                    continue;
                }

                var http = _httpFactory.Create();
                var url = $"{_cfg.Current.ApiBaseUrl.TrimEnd('/')}/api/agents/{_cfg.Current.AgentId}/updates/check";
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _cfg.Current.AgentKey);

                var resp = await http.SendAsync(req, stoppingToken);
                if (!resp.IsSuccessStatusCode)
                {
                    await Task.Delay(TimeSpan.FromMinutes(_cfg.Current.PollIntervals.UpdateCheckMinutes), stoppingToken);
                    continue;
                }

                var manifest = await resp.Content.ReadFromJsonAsync<UpdateManifest>(cancellationToken: stoppingToken);
                if (manifest is null || string.IsNullOrEmpty(manifest.Version) || string.IsNullOrEmpty(manifest.Url))
                {
                    await Task.Delay(TimeSpan.FromMinutes(_cfg.Current.PollIntervals.UpdateCheckMinutes), stoppingToken);
                    continue;
                }

                if (!string.IsNullOrEmpty(manifest.SignatureBase64))
                {
                    var canonical = $"{manifest.Version}|{manifest.Sha256Base64}|{manifest.Url}";
                    if (!_crypto.VerifyBlob(canonical, manifest.SignatureBase64))
                    {
                        _log.LogWarning("Update manifest signature invalid; ignoring.");
                        await Task.Delay(TimeSpan.FromMinutes(_cfg.Current.PollIntervals.UpdateCheckMinutes), stoppingToken);
                        continue;
                    }
                }

                await DownloadVerifyAndStage(manifest, stoppingToken);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Update check failed");
            }

            await Task.Delay(TimeSpan.FromMinutes(_cfg.Current.PollIntervals.UpdateCheckMinutes), stoppingToken);
        }
    }

    private async Task DownloadVerifyAndStage(UpdateManifest m, CancellationToken ct)
    {
        var http = _httpFactory.Create();
        var tmp = Path.Combine(Path.GetTempPath(), $"remoteiq-agent-{m.Version}.exe");
        using (var s = await http.GetStreamAsync(m.Url, ct))
        using (var f = File.Create(tmp))
            await s.CopyToAsync(f, ct);

        var bytes = await File.ReadAllBytesAsync(tmp, ct);
        var hash = SHA256.HashData(bytes);
        var b64 = Convert.ToBase64String(hash);
        if (!string.Equals(b64, m.Sha256Base64, StringComparison.Ordinal))
        {
            _log.LogError("Update hash mismatch. Expected {exp}, got {got}", m.Sha256Base64, b64);
            try { File.Delete(tmp); } catch { }
            return;
        }

        var stageFlag = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "RemoteIQ", "update.staged");
        Directory.CreateDirectory(Path.GetDirectoryName(stageFlag)!);
        await File.WriteAllTextAsync(stageFlag, tmp, ct);
        _log.LogInformation("Update {Version} staged at {Path}", m.Version, tmp);
    }
}
