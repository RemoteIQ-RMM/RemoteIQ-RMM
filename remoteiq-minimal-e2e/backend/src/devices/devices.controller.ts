// backend/src/devices/devices.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ListDevicesQuery } from "./dto";
import { DevicesService, type Device } from "./devices.service";
import { UninstallSoftwareDto } from "./dto/uninstall-software.dto";
import { JobsService } from "../jobs/jobs.service";
import { PgPoolService } from "../storage/pg-pool.service";
import { RequirePerm } from "../auth/require-perm.decorator";
import { IsOptional, IsString } from "class-validator";

class MoveDeviceSiteDto {
  // preferred (camelCase)
  @IsOptional()
  @IsString()
  siteId?: string;

  // fallback (snake_case) — helps if some UI code sends site_id
  @IsOptional()
  @IsString()
  site_id?: string;
}

@Controller("/api/devices")
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly jobs: JobsService,
    private readonly pg: PgPoolService
  ) { }

  @Get()
  @RequirePerm("devices.read")
  async list(@Query() query: ListDevicesQuery): Promise<{ items: Device[]; nextCursor: string | null }> {
    const { pageSize, cursor, q, status, os } = query;
    return this.devices.list({ pageSize, cursor, q, status, os });
  }

  @Get(":id")
  @RequirePerm("devices.read")
  async getOne(@Param("id") id: string): Promise<Device> {
    const dev = await this.devices.getOne(id);
    if (!dev) throw new NotFoundException("Device not found");
    return dev;
  }

  @Get(":id/software")
  @RequirePerm("devices.read")
  async software(
    @Param("id") id: string
  ): Promise<{
    items: Array<{
      id: string;
      name: string;
      version: string;
      publisher?: string | null;
      installDate?: string | null;
    }>;
  }> {
    const items = await this.devices.listSoftware(id);
    return { items };
  }

  // ✅ Move device to a different site (must remain within same client)
  @Patch(":id/site")
  @RequirePerm("devices.write")
  async moveToSite(@Param("id") id: string, @Body() body: MoveDeviceSiteDto): Promise<Device> {
    const siteIdRaw = (body?.siteId ?? body?.site_id ?? "") as string;
    const siteId = String(siteIdRaw).trim();

    if (!siteId) {
      throw new BadRequestException("siteId is required");
    }

    return await this.devices.moveToSite(id, siteId);
  }

  @Post(":id/actions/uninstall")
  @RequirePerm("devices.actions")
  @HttpCode(202)
  async uninstall(
    @Param("id") id: string,
    @Body() body: UninstallSoftwareDto
  ): Promise<{ accepted: true; jobId: string }> {
    const device = await this.devices.getOne(id);
    if (!device) throw new NotFoundException("Device not found");

    const name = body?.name?.trim();
    const version = body?.version?.trim();
    if (!name) throw new BadRequestException("name is required");

    const numericIdText = String(id);

    const deviceExternalId =
      (device as any).device_id ||
      (device as any).externalId ||
      (device as any).external_id ||
      (device as any).hostname ||
      null;

    const deviceHostname = (device as any).hostname || (device as any).host || (device as any).name || null;

    const { rows } = await this.pg.query<{ id: string }>(
      `
      SELECT a.id
        FROM agents a
       WHERE a.device_id = $1
          OR ($2::text IS NOT NULL AND a.device_id = $2::text)
          OR ($3::text IS NOT NULL AND a.hostname  = $3::text)
       LIMIT 1
      `,
      [numericIdText, deviceExternalId ?? null, deviceHostname ?? null]
    );

    const agent = rows[0];
    if (!agent) throw new NotFoundException("Agent not connected for this device");

    const { shell, script } = buildUninstallScript((device as any).os, name, version);

    const job = await this.jobs.createRunScriptJob({
      agentId: agent.id,
      language: shell === "powershell" ? "powershell" : "bash",
      scriptText: script,
      timeoutSec: 900,
    });

    return { accepted: true, jobId: job.id };
  }
}

function buildUninstallScript(
  osRaw: string | undefined,
  name: string,
  version?: string
): { shell: "powershell" | "bash"; script: string } {
  const os = (osRaw || "").toLowerCase();

  if (os.includes("win")) {
    const ps = `
$ErrorActionPreference = "Stop"

function Try-Winget {
  param([string]$Pkg, [string]$Ver)
  try {
    if ($Ver) {
      winget.exe uninstall --silent --exact --accept-source-agreements --accept-package-agreements --id "$Pkg" --version "$Ver" 2>$null
      if ($LASTEXITCODE -eq 0) { return $true }
      winget.exe uninstall --silent --accept-source-agreements --accept-package-agreements --name "$Pkg" --version "$Ver" 2>$null
      if ($LASTEXITCODE -eq 0) { return $true }
    } else {
      winget.exe uninstall --silent --exact --accept-source-agreements --accept-package-agreements --id "$Pkg" 2>$null
      if ($LASTEXITCODE -eq 0) { return $true }
      winget.exe uninstall --silent --accept-source-agreements --accept-package-agreements --name "$Pkg" 2>$null
      if ($LASTEXITCODE -eq 0) { return $true }
    }
  } catch {}
  return $false
}

function Try-MSI {
  param([string]$DisplayName)
  $roots = @(
    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  )
  $apps = Get-ItemProperty $roots | Where-Object { $_.DisplayName -and $_.DisplayName -like "*$DisplayName*" }
  foreach ($a in $apps) {
    if ($a.UninstallString) {
      $cmd = $a.UninstallString
      if ($cmd -match "msiexec\\.exe" -or $cmd -match "MsiExec\\.exe") {
        $cmd = "msiexec.exe /x " + ($a.PSChildName) + " /qn /norestart"
      }
      Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -Wait
      if ($LASTEXITCODE -eq 0) { return $true }
    }
  }
  return $false
}

$target = "${name.replace(/"/g, '""')}"
$wantedVersion = "${(version ?? "").replace(/"/g, '""')}"

Write-Output "Uninstalling '$target' (wanted version '$wantedVersion')"

if (Try-Winget $target $wantedVersion) { exit 0 }
if (Try-MSI $target) { exit 0 }

Write-Error "Failed to uninstall ${name}"
exit 1
`.trim();
    return { shell: "powershell", script: ps };
  }

  if (os.includes("mac") || os.includes("darwin")) {
    const bash = `
set -euo pipefail
NAME="${escapeBash(name)}"
VER="${escapeBash(version || "")}"

if command -v brew >/dev/null 2>&1; then
  if brew list --formula | grep -i -F "$NAME" >/dev/null 2>&1; then
    brew uninstall --force "$NAME" || true
  fi
  if brew list --cask | grep -i -F "$NAME" >/dev/null 2>&1; then
    brew uninstall --cask --force "$NAME" || true
  fi
fi

PKGID=$(pkgutil --pkgs | grep -i -F "$NAME" || true)
if [ -n "$PKGID" ]; then
  sudo pkgutil --forget "$PKGID" || true
fi

APP="/Applications/${escapeBash(name)}.app"
if [ -d "$APP" ]; then
  rm -rf "$APP" || true
fi

exit 0
`.trim();
    return { shell: "bash", script: bash };
  }

  const bash = `
set -euo pipefail
NAME="${escapeBash(name)}"

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y || true
  sudo apt-get remove -y "$NAME" || sudo apt-get purge -y "$NAME" || true
  exit 0
fi

if command -v dnf >/dev/null 2>&1; then
  sudo dnf remove -y "$NAME" || true
  exit 0
fi

if command -v yum >/dev/null 2>&1; then
  sudo yum remove -y "$NAME" || true
  exit 0
fi

if command -v pacman >/dev/null 2>&1; then
  sudo pacman -R --noconfirm "$NAME" || true
  exit 0
fi

echo "No supported package manager found or uninstall failed for ${escapeBash(name)}" 1>&2
exit 1
`.trim();

  return { shell: "bash", script: bash };
}

function escapeBash(s: string) {
  return s.replace(/(["`$\\])/g, "\\$1");
}
