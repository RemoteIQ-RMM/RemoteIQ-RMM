// RemoteIQ.Agent/Program.cs

using System;
using System.IO;
using System.Linq;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RemoteIQ.Agent.Services;
using Serilog;
using Serilog.Events;

var builder = Host.CreateApplicationBuilder(args);

// Optional: native DLL smoke test (run explicitly)
// Usage: RemoteIQ.Agent.exe --native-smoke [--native-smoke-cbs]
// RemoteIQ.Agent/Program.cs (only the smoke test block needs to match this)

if (args.Any(a => string.Equals(a, "--native-smoke", StringComparison.OrdinalIgnoreCase)))
{
    var code = NativeWebRtcSmokeTest.Run(args);
    Environment.ExitCode = code;
    return;
}


// Use ProgramData for logs (LocalService can write)
var baseData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
var logsDir = Path.Combine(baseData, "RemoteIQ", "Logs");
Directory.CreateDirectory(logsDir);

var loggerConfig = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .WriteTo.File(
        Path.Combine(logsDir, "agent-.log"),
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 14
    );

try
{
    loggerConfig = loggerConfig.WriteTo.EventLog(
        "RemoteIQ Agent",
        manageEventSource: false,
        restrictedToMinimumLevel: LogEventLevel.Warning
    );
}
catch { }

Log.Logger = loggerConfig.CreateLogger();

builder.Logging.ClearProviders();
builder.Logging.AddSerilog(Log.Logger, dispose: true);

builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "RemoteIQ Agent";
});

// Core services
builder.Services.AddSingleton<ConfigService>();
builder.Services.AddSingleton<CryptoService>();
builder.Services.AddSingleton<PinnedHttpClientFactory>();
builder.Services.AddSingleton<SystemInfoCollector>();
builder.Services.AddSingleton<ScriptExecutor>();

// Hosted services
builder.Services.AddHostedService<EnrollmentService>();
builder.Services.AddHostedService<HeartbeatService>();
builder.Services.AddHostedService<InventoryService>();

builder.Services.AddHostedService<TaskWorker>();
builder.Services.AddHostedService<RemoteShellWorker>();
builder.Services.AddHostedService<RemoteDesktopTunnelWorker>();

builder.Services.AddSingleton<IWebRtcConsolePeerFactory, NativeWebRtcConsolePeerFactory>();
builder.Services.AddHostedService<RemoteConsoleWorker>();
builder.Services.AddHostedService<RemoteConsoleTunnelWorker>();

builder.Services.AddHostedService<UpdateService>();

builder.Services.AddSingleton<PatchService>();
builder.Services.AddHostedService<AgentTaskWorkerService>();

var host = builder.Build();
await host.RunAsync();
