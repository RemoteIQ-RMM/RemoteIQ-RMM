// RemoteIQ.Agent/Services/AgentTaskWorkerService.cs

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class AgentTaskWorkerService : BackgroundService
{
    private readonly ConfigService _cfg;
    private readonly PinnedHttpClientFactory _httpFactory;
    private readonly PatchService _patch;
    private readonly ILogger<AgentTaskWorkerService> _log;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    public AgentTaskWorkerService(
        ConfigService cfg,
        PinnedHttpClientFactory httpFactory,
        PatchService patch,
        ILogger<AgentTaskWorkerService> log)
    {
        _cfg = cfg;
        _httpFactory = httpFactory;
        _patch = patch;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var idleDelay = TimeSpan.FromSeconds(10);
        var afterWorkDelay = TimeSpan.FromSeconds(2);
        var errorDelay = TimeSpan.FromSeconds(5);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_cfg.Current.AgentId) ||
                    string.IsNullOrWhiteSpace(_cfg.Current.AgentKey) ||
                    string.IsNullOrWhiteSpace(_cfg.Current.ApiBaseUrl))
                {
                    await Task.Delay(idleDelay, stoppingToken);
                    continue;
                }

                var http = _httpFactory.Create();
                http.DefaultRequestHeaders.Authorization =
                    new AuthenticationHeaderValue("Bearer", _cfg.Current.AgentKey);

                var baseUrl = _cfg.Current.ApiBaseUrl.TrimEnd('/');

                // ✅ Backend is POST /api/agent/tasks/next
                var nextUrl = $"{baseUrl}/api/agent/tasks/next";
                using var resp = await http.PostAsync(nextUrl, content: null, cancellationToken: stoppingToken);

                if (resp.StatusCode == HttpStatusCode.NoContent)
                {
                    await Task.Delay(idleDelay, stoppingToken);
                    continue;
                }

                if (!resp.IsSuccessStatusCode)
                {
                    var bodyText = "";
                    try { bodyText = await resp.Content.ReadAsStringAsync(stoppingToken); } catch { /* ignore */ }

                    // Always show the status at WARNING (your logger is Info+, so you'll actually see it)
                    _log.LogWarning("Task next failed: HTTP {Status} {Reason}. Body: {Body}",
                        (int)resp.StatusCode, resp.ReasonPhrase ?? "", bodyText);

                    await Task.Delay(idleDelay, stoppingToken);
                    continue;
                }


                var nextResp = await resp.Content.ReadFromJsonAsync<NextTaskResponse>(JsonOpts, stoppingToken);
                if (nextResp?.Task is null || nextResp.Run is null ||
                    string.IsNullOrWhiteSpace(nextResp.Task.Id) ||
                    string.IsNullOrWhiteSpace(nextResp.Run.Id))
                {
                    await Task.Delay(idleDelay, stoppingToken);
                    continue;
                }

                var taskId = nextResp.Task.Id;
                var runId = nextResp.Run.Id;

                _log.LogInformation("Claimed task {TaskId} type={Type} run={RunId} attempt={Attempt}",
                    taskId, nextResp.Task.Type, runId, nextResp.Run.Attempt);

                if (string.Equals(nextResp.Task.Type, "patch_scan", StringComparison.OrdinalIgnoreCase))
                {
                    await HandlePatchScan(http, baseUrl, taskId, runId, nextResp.Task.Payload, stoppingToken);
                }
                else if (string.Equals(nextResp.Task.Type, "patch_install", StringComparison.OrdinalIgnoreCase))
                {
                    await HandlePatchInstall(http, baseUrl, taskId, runId, nextResp.Task.Payload, stoppingToken);
                }
                else
                {
                    await Complete(http, baseUrl, taskId, runId,
                        status: "failed",
                        stdout: null,
                        stderr: $"Unknown task type: {nextResp.Task.Type}",
                        output: new { ok = false },
                        artifacts: null,
                        ct: stoppingToken);
                }

                await Task.Delay(afterWorkDelay, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _log.LogDebugThrottled("task-worker", TimeSpan.FromMinutes(1),
                    "Task worker error: {Msg}", ex.Message);
                await Task.Delay(errorDelay, stoppingToken);
            }
        }
    }

    private async Task HandlePatchScan(
        HttpClient http,
        string baseUrl,
        string taskId,
        string runId,
        Dictionary<string, object>? payload,
        CancellationToken ct)
    {
        try
        {
            var includeOptional = ReadBool(payload, "includeOptional", defaultValue: false);
            var patches = _patch.ScanWindowsUpdates(includeOptional);

            var artifacts = new
            {
                patches = patches.Select(p => new
                {
                    id = p.Id,
                    title = p.Title,
                    severity = p.Severity,
                    requiresReboot = p.RequiresReboot,
                    kbIds = p.KbIds
                }).ToList()
            };

            await Complete(http, baseUrl, taskId, runId,
                status: "succeeded",
                stdout: $"Found {patches.Count} available update(s).",
                stderr: null,
                output: new { ok = true, count = patches.Count },
                artifacts: artifacts,
                ct: ct);
        }
        catch (Exception ex)
        {
            await Complete(http, baseUrl, taskId, runId,
                status: "failed",
                stdout: null,
                stderr: ex.Message,
                output: new { ok = false },
                artifacts: null,
                ct: ct);
        }
    }

    private async Task HandlePatchInstall(
        HttpClient http,
        string baseUrl,
        string taskId,
        string runId,
        Dictionary<string, object>? payload,
        CancellationToken ct)
    {
        try
        {
            var includeOptional = ReadBool(payload, "includeOptional", defaultValue: false);
            var ids = ReadStringArray(payload, "ids");

            if (ids.Length == 0)
            {
                await Complete(http, baseUrl, taskId, runId,
                    status: "failed",
                    stdout: null,
                    stderr: "payload.ids is required",
                    output: new { ok = false },
                    artifacts: null,
                    ct: ct);
                return;
            }

            var (ok, stdout, stderr, reboot) = _patch.InstallWindowsUpdatesByIds(ids, includeOptional);

            await Complete(http, baseUrl, taskId, runId,
                status: ok ? "succeeded" : "failed",
                stdout: stdout,
                stderr: stderr,
                output: new { ok, requiresReboot = reboot },
                artifacts: new { installed = ids, requiresReboot = reboot },
                ct: ct);
        }
        catch (Exception ex)
        {
            await Complete(http, baseUrl, taskId, runId,
                status: "failed",
                stdout: null,
                stderr: ex.Message,
                output: new { ok = false },
                artifacts: null,
                ct: ct);
        }
    }

    // ✅ Backend endpoint is POST /api/agent/tasks/complete
    private static async Task Complete(
        HttpClient http,
        string baseUrl,
        string taskId,
        string runId,
        string status,
        string? stdout,
        string? stderr,
        object? output,
        object? artifacts,
        CancellationToken ct)
    {
        var url = $"{baseUrl}/api/agent/tasks/complete";
        var body = new
        {
            taskId,
            runId,
            status,
            stdout,
            stderr,
            output,
            artifacts
        };

        var resp = await http.PostAsJsonAsync(url, body, JsonOpts, ct);
        resp.EnsureSuccessStatusCode();
    }

    private static bool ReadBool(Dictionary<string, object>? payload, string key, bool defaultValue)
    {
        if (payload is null) return defaultValue;
        if (!payload.TryGetValue(key, out var raw) || raw is null) return defaultValue;

        try
        {
            if (raw is bool b) return b;

            if (raw is JsonElement je)
            {
                if (je.ValueKind == JsonValueKind.True) return true;
                if (je.ValueKind == JsonValueKind.False) return false;

                if (je.ValueKind == JsonValueKind.Number && je.TryGetInt32(out var i)) return i != 0;
                if (je.ValueKind == JsonValueKind.String && bool.TryParse(je.GetString(), out var sb)) return sb;
            }

            if (raw is string s && bool.TryParse(s, out var bs)) return bs;
            if (raw is int i2) return i2 != 0;
            if (raw is long l2) return l2 != 0;
        }
        catch
        {
            // ignore
        }

        return defaultValue;
    }

    private static string[] ReadStringArray(Dictionary<string, object>? payload, string key)
    {
        if (payload is null) return Array.Empty<string>();
        if (!payload.TryGetValue(key, out var raw) || raw is null) return Array.Empty<string>();

        try
        {
            if (raw is JsonElement je && je.ValueKind == JsonValueKind.Array)
            {
                return je.EnumerateArray()
                    .Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() : x.ToString())
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Select(s => s!.Trim())
                    .ToArray();
            }

            if (raw is object[] arr)
            {
                return arr.Select(x => x?.ToString() ?? "")
                    .Where(s => !string.IsNullOrWhiteSpace(s))
                    .Select(s => s.Trim())
                    .ToArray();
            }

            if (raw is string s && !string.IsNullOrWhiteSpace(s))
                return new[] { s.Trim() };
        }
        catch
        {
            // ignore
        }

        return Array.Empty<string>();
    }

    // Matches backend response: { ok, task, run }
    private sealed class NextTaskResponse
    {
        public bool Ok { get; set; }
        public ClaimedTask? Task { get; set; }
        public ClaimedRun? Run { get; set; }
    }

    private sealed class ClaimedTask
    {
        public string Id { get; set; } = "";
        public string Type { get; set; } = "";
        public Dictionary<string, object>? Payload { get; set; }
    }

    private sealed class ClaimedRun
    {
        public string Id { get; set; } = "";
        public string TaskId { get; set; } = "";
        public int Attempt { get; set; }
        public string Status { get; set; } = "";
        public string StartedAt { get; set; } = "";
    }
}
