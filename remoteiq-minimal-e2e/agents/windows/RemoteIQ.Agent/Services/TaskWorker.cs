//remoteiq-minimal-e2e\agents\windows\RemoteIQ.Agent\Services\TaskWorker.cs

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

    // Safety limits (adjust later if you want)
    private const int DefaultMaxListEntries = 2000;
    private const int DefaultMaxReadBytes = 2 * 1024 * 1024; // 2MB

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
                else if (t == "job_file_op")
                {
                    await HandleJobFileOp(ws, root, ct);
                }
                else
                {
                    // helpful during development; throttled
                    _log.LogDebugThrottled("ws_unknown", TimeSpan.FromMinutes(1), "WS unknown message type: {T}", t);
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
        var jobId = ReadString(root, "jobId") ?? ReadString(root, "id") ?? "";
        if (string.IsNullOrWhiteSpace(jobId)) return;

        var language = ReadString(root, "language") ?? "powershell";
        var scriptText = ReadString(root, "scriptText") ?? "";
        var timeoutSec = ReadInt(root, "timeoutSec") ?? 120;

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

        await SendJobResult(ws, jobId, exitCode, stdout, stderr, durationMs, status, ct);
    }

    private async Task HandleJobFileOp(ClientWebSocket ws, JsonElement root, CancellationToken ct)
    {
        // Accept jobId OR id
        var jobId = ReadString(root, "jobId") ?? ReadString(root, "id") ?? "";
        if (string.IsNullOrWhiteSpace(jobId)) return;

        // Backend may send op/path at root, OR nested under payload
        var payload = root;
        if (root.TryGetProperty("payload", out var payloadEl) && payloadEl.ValueKind == JsonValueKind.Object)
            payload = payloadEl;

        var op = ReadString(payload, "op") ?? "";

        // IMPORTANT: allow "roots" and sentinel paths used by UI/backend
        var pathRaw = ReadString(payload, "path") ?? "";

        var sw = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            // Defaults & options
            var recursive = ReadBool(payload, "recursive") ?? false;
            var includeHidden = ReadBool(payload, "includeHidden") ?? false;
            var includeSystem = ReadBool(payload, "includeSystem") ?? false;

            var maxBytes = DefaultMaxReadBytes;
            var mb = ReadInt(payload, "maxBytes");
            if (mb.HasValue)
                maxBytes = Math.Clamp(mb.Value, 1, 50 * 1024 * 1024); // cap 50MB

            // dev logging so we can confirm delivery
            _log.LogInformation("FILE_OP job received: {JobId} op={Op} path={Path}", jobId, op, pathRaw);

            object result;

            switch ((op ?? "").ToLowerInvariant())
            {
                case "roots":
                    {
                        var items = ListRoots();
                        result = new
                        {
                            ok = true,
                            op = "roots",
                            items
                        };
                        break;
                    }

                case "list":
                    {
                        // Treat initial sentinel values as roots
                        if (IsRootsSentinel(pathRaw))
                        {
                            var items = ListRoots();
                            result = new
                            {
                                ok = true,
                                op = "roots",
                                items
                            };
                            break;
                        }

                        var path = NormalizeAndValidateLocalPath(pathRaw);

                        var items2 = ListPath(path, recursive, DefaultMaxListEntries, includeHidden, includeSystem);
                        result = new
                        {
                            ok = true,
                            op = "list",
                            path,
                            items = items2
                        };
                        break;
                    }

                case "stat":
                    {
                        if (IsRootsSentinel(pathRaw))
                            throw new InvalidOperationException("stat is not valid for roots");

                        var path = NormalizeAndValidateLocalPath(pathRaw);
                        result = new
                        {
                            ok = true,
                            op = "stat",
                            path,
                            entry = StatPath(path)
                        };
                        break;
                    }

                case "read":
                    {
                        if (IsRootsSentinel(pathRaw))
                            throw new InvalidOperationException("read is not valid for roots");

                        var path = NormalizeAndValidateLocalPath(pathRaw);

                        var (contentBase64, size, truncated) = ReadFileBase64(path, maxBytes);
                        result = new
                        {
                            ok = true,
                            op = "read",
                            path,
                            sizeBytes = size,
                            maxBytes,
                            truncated,
                            contentBase64
                        };
                        break;
                    }

                case "write":
                    {
                        if (IsRootsSentinel(pathRaw))
                            throw new InvalidOperationException("write is not valid for roots");

                        var path = NormalizeAndValidateLocalPath(pathRaw);

                        var contentB64 = ReadString(payload, "contentBase64") ?? "";
                        if (string.IsNullOrWhiteSpace(contentB64))
                            throw new InvalidOperationException("contentBase64 is required for write");

                        var bytes = Convert.FromBase64String(contentB64);
                        EnsureParentDir(path);
                        File.WriteAllBytes(path, bytes);

                        result = new
                        {
                            ok = true,
                            op = "write",
                            path,
                            sizeBytes = bytes.Length
                        };
                        break;
                    }

                case "mkdir":
                    {
                        if (IsRootsSentinel(pathRaw))
                            throw new InvalidOperationException("mkdir is not valid for roots");

                        var path = NormalizeAndValidateLocalPath(pathRaw);

                        Directory.CreateDirectory(path);
                        result = new
                        {
                            ok = true,
                            op = "mkdir",
                            path
                        };
                        break;
                    }

                case "delete":
                    {
                        if (IsRootsSentinel(pathRaw))
                            throw new InvalidOperationException("delete is not valid for roots");

                        var path = NormalizeAndValidateLocalPath(pathRaw);

                        var deleted = DeletePath(path, recursive);
                        result = new
                        {
                            ok = true,
                            op = "delete",
                            path,
                            deleted
                        };
                        break;
                    }

                case "move":
                    {
                        if (IsRootsSentinel(pathRaw))
                            throw new InvalidOperationException("move is not valid for roots");

                        var path = NormalizeAndValidateLocalPath(pathRaw);

                        var path2Raw = ReadString(payload, "path2") ?? "";
                        var dest = NormalizeAndValidateLocalPath(path2Raw);
                        EnsureParentDir(dest);

                        MovePath(path, dest);
                        result = new
                        {
                            ok = true,
                            op = "move",
                            path,
                            path2 = dest
                        };
                        break;
                    }

                case "copy":
                    {
                        if (IsRootsSentinel(pathRaw))
                            throw new InvalidOperationException("copy is not valid for roots");

                        var path = NormalizeAndValidateLocalPath(pathRaw);

                        var path2Raw = ReadString(payload, "path2") ?? "";
                        var dest = NormalizeAndValidateLocalPath(path2Raw);
                        EnsureParentDir(dest);

                        CopyPath(path, dest, recursive: true);
                        result = new
                        {
                            ok = true,
                            op = "copy",
                            path,
                            path2 = dest
                        };
                        break;
                    }

                default:
                    throw new InvalidOperationException($"Unknown file op: {op}");
            }

            sw.Stop();
            var stdout = JsonSerializer.Serialize(result);
            await SendJobResult(ws, jobId, 0, stdout, "", sw.ElapsedMilliseconds, "succeeded", ct);
        }
        catch (Exception ex)
        {
            sw.Stop();
            var stderr = ex.Message;
            await SendJobResult(ws, jobId, -1, "", stderr, sw.ElapsedMilliseconds, "failed", ct);
        }
    }

    private static bool IsRootsSentinel(string? pathRaw)
    {
        if (string.IsNullOrWhiteSpace(pathRaw)) return true;
        var s = pathRaw.Trim();
        return s.Equals("__drives__", StringComparison.OrdinalIgnoreCase) ||
               s.Equals("__roots__", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ReadString(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var el)) return null;
        return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
    }

    private static int? ReadInt(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var el)) return null;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var i)) return i;
        if (el.ValueKind == JsonValueKind.String && int.TryParse(el.GetString(), out var si)) return si;
        return null;
    }

    private static bool? ReadBool(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var el)) return null;
        if (el.ValueKind == JsonValueKind.True) return true;
        if (el.ValueKind == JsonValueKind.False) return false;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var i)) return i != 0;
        if (el.ValueKind == JsonValueKind.String && bool.TryParse(el.GetString(), out var b)) return b;
        return null;
    }

    /* ----------------------------- File helpers ----------------------------- */

    private static string NormalizeAndValidateLocalPath(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException("path is required");

        var s = raw.Trim();

        // Disallow UNC paths (\\server\share) for now (safer; can add later)
        if (s.StartsWith(@"\\", StringComparison.Ordinal))
            throw new InvalidOperationException("UNC paths are not allowed");

        // Require absolute paths
        if (!Path.IsPathRooted(s))
            throw new InvalidOperationException("path must be an absolute local path");

        // Normalize
        var full = Path.GetFullPath(s);

        // Basic sanity: prevent odd device paths
        if (full.StartsWith(@"\\?\", StringComparison.Ordinal))
            throw new InvalidOperationException(@"\\?\ device paths are not allowed");

        return full;
    }

    private static void EnsureParentDir(string path)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(dir))
            Directory.CreateDirectory(dir);
    }

    private sealed class RootItem
    {
        public string Name { get; init; } = "";
        public string FullPath { get; init; } = "";
        public bool IsDir { get; init; } = true;
        public bool IsRoot { get; init; } = true;
        public string DriveType { get; init; } = "";
        public bool IsReady { get; init; }
        public string? VolumeLabel { get; init; }
        public string? Fs { get; init; }
        public long? TotalBytes { get; init; }
        public long? FreeBytes { get; init; }
        public string? ModifiedUtc { get; init; }
    }

    private static object[] ListRoots()
    {
        var list = new List<RootItem>();

        try
        {
            foreach (var d in DriveInfo.GetDrives())
            {
                bool ready = false;
                string name = d.Name; // e.g. "C:\"
                string? label = null;
                string? fs = null;
                long? total = null;
                long? free = null;

                try
                {
                    ready = d.IsReady;
                    if (ready)
                    {
                        label = string.IsNullOrWhiteSpace(d.VolumeLabel) ? null : d.VolumeLabel.Trim();
                        fs = string.IsNullOrWhiteSpace(d.DriveFormat) ? null : d.DriveFormat.Trim();
                        total = d.TotalSize > 0 ? d.TotalSize : null;
                        free = d.AvailableFreeSpace >= 0 ? d.AvailableFreeSpace : null;
                    }
                }
                catch
                {
                    // ignore
                }

                list.Add(new RootItem
                {
                    Name = name,
                    FullPath = name.TrimEnd('\\'),
                    DriveType = d.DriveType.ToString(),
                    IsReady = ready,
                    VolumeLabel = label,
                    Fs = fs,
                    TotalBytes = total,
                    FreeBytes = free,
                    ModifiedUtc = null
                });
            }
        }
        catch
        {
            // ignore
        }

        return list
            .OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .Select(x => (object)new
            {
                name = x.Name,
                fullPath = x.FullPath,
                isDir = x.IsDir,
                isRoot = x.IsRoot,
                driveType = x.DriveType,
                isReady = x.IsReady,
                volumeLabel = x.VolumeLabel,
                fs = x.Fs,
                totalBytes = x.TotalBytes,
                freeBytes = x.FreeBytes,
                modifiedUtc = x.ModifiedUtc
            })
            .ToArray();
    }

    private static object StatPath(string path)
    {
        if (File.Exists(path))
        {
            var fi = new FileInfo(path);
            return new
            {
                name = fi.Name,
                fullPath = fi.FullName,
                isDir = false,
                sizeBytes = fi.Length,
                modifiedUtc = fi.LastWriteTimeUtc.ToString("o"),
                attributes = fi.Attributes.ToString()
            };
        }

        if (Directory.Exists(path))
        {
            var di = new DirectoryInfo(path);
            return new
            {
                name = di.Name,
                fullPath = di.FullName,
                isDir = true,
                sizeBytes = (long?)null,
                modifiedUtc = di.LastWriteTimeUtc.ToString("o"),
                attributes = di.Attributes.ToString()
            };
        }

        throw new FileNotFoundException("Path not found", path);
    }

    private static object[] ListPath(string path, bool recursive, int maxEntries, bool includeHidden, bool includeSystem)
    {
        // If it's a file, return a single entry describing the file
        if (File.Exists(path))
        {
            var fi = new FileInfo(path);
            return new object[]
            {
                new
                {
                    name = fi.Name,
                    fullPath = fi.FullName,
                    isDir = false,
                    sizeBytes = fi.Length,
                    modifiedUtc = fi.LastWriteTimeUtc.ToString("o")
                }
            };
        }

        // If directory doesn't exist, throw
        if (!Directory.Exists(path))
            throw new FileNotFoundException("Path not found", path);

        var opts = new EnumerationOptions
        {
            RecurseSubdirectories = recursive,
            IgnoreInaccessible = true,
            AttributesToSkip = FileAttributes.ReparsePoint // avoid symlink loops
        };

        var list = new List<(bool isDir, string name, string fullPath, long? sizeBytes, string modifiedUtc)>(Math.Min(maxEntries, 256));
        var count = 0;

        foreach (var entry in Directory.EnumerateFileSystemEntries(path, "*", opts))
        {
            if (count >= maxEntries) break;

            try
            {
                var attr = File.GetAttributes(entry);

                // Filter hidden/system unless explicitly allowed
                if (!includeHidden && (attr & FileAttributes.Hidden) != 0) continue;
                if (!includeSystem && (attr & FileAttributes.System) != 0) continue;

                var isDir = (attr & FileAttributes.Directory) != 0;

                if (isDir)
                {
                    var di = new DirectoryInfo(entry);
                    list.Add((
                        isDir: true,
                        name: di.Name,
                        fullPath: di.FullName,
                        sizeBytes: null,
                        modifiedUtc: di.LastWriteTimeUtc.ToString("o")
                    ));
                }
                else
                {
                    var fi = new FileInfo(entry);
                    list.Add((
                        isDir: false,
                        name: fi.Name,
                        fullPath: fi.FullName,
                        sizeBytes: fi.Length,
                        modifiedUtc: fi.LastWriteTimeUtc.ToString("o")
                    ));
                }

                count++;
            }
            catch
            {
                // ignore bad entries (permissions/races)
            }
        }

        // Directories first, then name
        return list
            .OrderByDescending(x => x.isDir)
            .ThenBy(x => x.name, StringComparer.OrdinalIgnoreCase)
            .Select(x => (object)new
            {
                name = x.name,
                fullPath = x.fullPath,
                isDir = x.isDir,
                sizeBytes = x.sizeBytes,
                modifiedUtc = x.modifiedUtc
            })
            .ToArray();
    }

    private static (string contentBase64, long size, bool truncated) ReadFileBase64(string path, int maxBytes)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException("File not found", path);

        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var size = fs.Length;

        var toRead = (int)Math.Min(size, maxBytes);
        var buf = new byte[toRead];

        var read = 0;
        while (read < toRead)
        {
            var n = fs.Read(buf, read, toRead - read);
            if (n <= 0) break;
            read += n;
        }

        var truncated = size > maxBytes;
        var content = Convert.ToBase64String(read == buf.Length ? buf : buf.Take(read).ToArray());
        return (content, size, truncated);
    }

    private static bool DeletePath(string path, bool recursive)
    {
        if (File.Exists(path))
        {
            File.Delete(path);
            return true;
        }

        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive);
            return true;
        }

        return false;
    }

    private static void MovePath(string src, string dest)
    {
        if (File.Exists(src))
        {
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(src, dest);
            return;
        }

        if (Directory.Exists(src))
        {
            if (Directory.Exists(dest))
                throw new IOException("Destination directory already exists");
            Directory.Move(src, dest);
            return;
        }

        throw new FileNotFoundException("Source path not found", src);
    }

    private static void CopyPath(string src, string dest, bool recursive)
    {
        if (File.Exists(src))
        {
            File.Copy(src, dest, overwrite: true);
            return;
        }

        if (!Directory.Exists(src))
            throw new FileNotFoundException("Source path not found", src);

        // Directory copy
        Directory.CreateDirectory(dest);

        foreach (var file in Directory.GetFiles(src))
        {
            var name = Path.GetFileName(file);
            var outPath = Path.Combine(dest, name);
            File.Copy(file, outPath, overwrite: true);
        }

        if (!recursive) return;

        foreach (var dir in Directory.GetDirectories(src))
        {
            var name = Path.GetFileName(dir);
            var outDir = Path.Combine(dest, name);
            CopyPath(dir, outDir, recursive: true);
        }
    }

    /* ----------------------------- WS helpers ------------------------------ */

    private static async Task SendJobResult(
        ClientWebSocket ws,
        string jobId,
        int exitCode,
        string stdout,
        string stderr,
        long durationMs,
        string status,
        CancellationToken ct)
    {
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

        builder.Path = "/ws/agent";
        return builder.Uri;
    }
}
