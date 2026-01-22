using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace RemoteIQ.Agent.Services;

public sealed class TaskWorker : BackgroundService
{
    private readonly ConfigService _cfg;
    private readonly ILogger<TaskWorker> _log;
    private readonly ScriptExecutor _exec;

    public TaskWorker(ConfigService cfg, ILogger<TaskWorker> log, ScriptExecutor exec)
    {
        _cfg = cfg;
        _log = log;
        _exec = exec;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            if (string.IsNullOrEmpty(_cfg.Current.AgentId) || string.IsNullOrEmpty(_cfg.Current.AgentKey))
            {
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
                continue;
            }

            var wsUri = BuildAgentWsUri(_cfg.Current.ApiBaseUrl);
            if (wsUri is null)
            {
                _log.LogError("Invalid ApiBaseUrl for WS: {ApiBaseUrl}", _cfg.Current.ApiBaseUrl);
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                continue;
            }

            using var ws = new ClientWebSocket();

            try
            {
                // NOTE: backend currently doesn’t authenticate WS; we still include token in hello for future hardening.
                await ws.ConnectAsync(wsUri, stoppingToken);
                _log.LogInformation("Connected to agent WS: {Uri}", wsUri);

                await SendHello(ws, stoppingToken);

                await ReceiveLoop(ws, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Agent WS error; reconnecting in 5s");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }

    private async Task SendHello(ClientWebSocket ws, CancellationToken ct)
    {
        var hello = new
        {
            t = "agent_hello",
            agentId = _cfg.Current.AgentId,
            deviceId = _cfg.Current.DeviceId,
            hostname = Environment.MachineName,
            os = "windows",
            arch = Environment.Is64BitOperatingSystem ? "x64" : "x86",
            version = typeof(TaskWorker).Assembly.GetName().Version?.ToString() ?? "1.0.0",
            token = _cfg.Current.AgentKey, // not used by backend today, reserved for future validation
        };

        await SendJson(ws, hello, ct);
    }

    private async Task ReceiveLoop(ClientWebSocket ws, CancellationToken ct)
    {
        var buf = new byte[64 * 1024];

        while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            var ms = new MemoryStream();
            WebSocketReceiveResult? res = null;

            do
            {
                res = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                if (res.MessageType == WebSocketMessageType.Close)
                {
                    try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "closing", ct); } catch { /* ignore */ }
                    return;
                }

                ms.Write(buf, 0, res.Count);
            }
            while (!res.EndOfMessage);

            var text = Encoding.UTF8.GetString(ms.ToArray());
            if (string.IsNullOrWhiteSpace(text)) continue;

            try
            {
                using var doc = JsonDocument.Parse(text);
                var root = doc.RootElement;

                if (!root.TryGetProperty("t", out var tProp)) continue;
                var t = tProp.GetString() ?? "";

                if (t == "job_run_script")
                {
                    await HandleJobRunScript(ws, root, ct);
                }
            }
            catch (Exception ex)
            {
                _log.LogDebugThrottled("ws_parse", TimeSpan.FromMinutes(1), "WS parse error: {Msg}", ex.Message);
            }
        }
    }

    private async Task HandleJobRunScript(ClientWebSocket ws, JsonElement root, CancellationToken ct)
    {
        var jobId = root.TryGetProperty("jobId", out var jid) ? (jid.GetString() ?? "") : "";
        if (string.IsNullOrWhiteSpace(jobId)) return;

        var language = root.TryGetProperty("language", out var lang) ? (lang.GetString() ?? "powershell") : "powershell";
        var scriptText = root.TryGetProperty("scriptText", out var st) ? (st.GetString() ?? "") : "";
        var timeoutSec = root.TryGetProperty("timeoutSec", out var ts) && ts.TryGetInt32(out var tsv) ? tsv : 120;

        var args = new List<string>();
        if (root.TryGetProperty("args", out var argsEl) && argsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var a in argsEl.EnumerateArray())
                args.Add(a.GetString() ?? "");
        }

        var env = new Dictionary<string, string>(StringComparer.Ordinal);
        if (root.TryGetProperty("env", out var envEl) && envEl.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in envEl.EnumerateObject())
                env[p.Name] = p.Value.GetString() ?? "";
        }

        int exitCode;
        string stdout;
        string stderr;
        long durationMs;
        string status;

        if (string.Equals(language, "powershell", StringComparison.OrdinalIgnoreCase))
        {
            (exitCode, stdout, stderr, durationMs, status) =
                await _exec.RunPowerShellAsync(scriptText, args.ToArray(), env, timeoutSec, ct);
        }
        else
        {
            exitCode = -1;
            stdout = "";
            stderr = $"Unsupported language on Windows agent: {language}";
            durationMs = 0;
            status = "failed";
        }

        var result = new
        {
            t = "job_result",
            jobId,
            exitCode,
            stdout,
            stderr,
            durationMs,
            status,
        };

        await SendJson(ws, result, ct);
    }

    private static async Task SendJson(ClientWebSocket ws, object payload, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(payload);
        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    private static Uri? BuildAgentWsUri(string apiBaseUrl)
    {
        if (string.IsNullOrWhiteSpace(apiBaseUrl)) return null;
        if (!Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var u)) return null;

        var scheme = u.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws";
        var builder = new UriBuilder(u)
        {
            Scheme = scheme,
            Path = "/ws/agent",
        };

        // If base URL had a path, override fully to /ws/agent
        builder.Path = "/ws/agent";

        return builder.Uri;
    }
}
