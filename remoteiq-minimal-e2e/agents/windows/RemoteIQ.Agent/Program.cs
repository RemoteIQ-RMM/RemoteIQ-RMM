using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Serilog;
using Serilog.Events;
using RemoteIQ.Agent.Services;

var builder = Host.CreateApplicationBuilder(args);

// Use ProgramData for logs (LocalService can write)
var baseData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
var logsDir = Path.Combine(baseData, "RemoteIQ", "Logs");
Directory.CreateDirectory(logsDir);

var loggerConfig = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .WriteTo.File(Path.Combine(logsDir, "agent-.log"), rollingInterval: RollingInterval.Day, retainedFileCountLimit: 14);

// EventLog source creation requires admin; write without managing the source to avoid startup failures.
loggerConfig = loggerConfig.WriteTo.EventLog("RemoteIQ Agent", manageEventSource: false, restrictedToMinimumLevel: LogEventLevel.Warning);

Log.Logger = loggerConfig.CreateLogger();
builder.Logging.ClearProviders();
builder.Logging.AddSerilog(Log.Logger, dispose: true);

builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "RemoteIQ Agent";
});

builder.Services.AddSingleton<ConfigService>();
builder.Services.AddSingleton<CryptoService>();
builder.Services.AddSingleton<PinnedHttpClientFactory>();
builder.Services.AddSingleton<SystemInfoCollector>();
builder.Services.AddSingleton<ScriptExecutor>();

builder.Services.AddHostedService<EnrollmentService>();
builder.Services.AddHostedService<HeartbeatService>();
builder.Services.AddHostedService<InventoryService>();

// WS-based job execution (dispatcher.service.ts -> /ws/agent -> job_run_script)
builder.Services.AddHostedService<TaskWorker>();

// Keep UpdateService optional (it will effectively no-op if endpoint doesn’t exist)
builder.Services.AddHostedService<UpdateService>();

var host = builder.Build();
await host.RunAsync();
