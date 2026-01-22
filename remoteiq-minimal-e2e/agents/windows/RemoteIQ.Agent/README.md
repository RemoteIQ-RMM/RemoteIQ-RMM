# RemoteIQ Windows Agent

A secure .NET 8 Windows Service that enrolls with the RemoteIQ backend, sends heartbeats and inventory, executes **signed** tasks, uploads artifacts (via task handlers), and supports staged self-updates.

## Build

```powershell
dotnet restore
dotnet publish -c Release -r win-x64
```

Artifacts: `./bin/Release/net8.0/win-x64/publish/RemoteIQ.Agent.exe`

## Install (Admin PowerShell)

```powershell
cd agents/windows/RemoteIQ.Agent/scripts
./install-agent.ps1 -ApiBaseUrl "https://YOUR_API" -AgentGroup "default"
```

Service account: **LocalService** (least privilege).

## Logs & Config

- Logs: `%ProgramData%/RemoteIQ/Logs/agent-*.log`
- Config: `%ProgramData%/RemoteIQ/agent.config.json` (DPAPI-protected secret fields)

## Security

- **Signed tasks only**: RSA-PSS signatures validated using your server **public key** in `appsettings.json`.
- **DPAPI at rest**: `AgentKey` is encrypted using `LocalMachine` DPAPI.
- **Optional TLS certificate pinning**: enable and set `PinnedSpkiSha256` for SPKI pins.
- **Least privilege**: runs under LocalService by default.

## Backend Endpoints (actual)

REST (authenticated with `Authorization: Bearer {agentToken}`):

- `POST /api/agent/enroll` → `{ agentId, agentToken, deviceId, agentUuid }`
- `POST /api/agent/ping`
- `POST /api/agent/software`

WebSocket:

- Agent connects to `/ws/agent`
- Sends `{ t:"agent_hello", agentId, deviceId, ... }`
- Receives `{ t:"job_run_script", jobId, language, scriptText, args, env, timeoutSec }`
- Responds `{ t:"job_result", jobId, exitCode, stdout, stderr, durationMs, status }`

> Adjust URLs in services if your NestJS controllers differ.

## Uninstall

```powershell
cd agents/windows/RemoteIQ.Agent/scripts
./uninstall-agent.ps1
```
