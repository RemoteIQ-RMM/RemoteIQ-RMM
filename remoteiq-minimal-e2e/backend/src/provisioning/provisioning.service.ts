// backend/src/provisioning/provisioning.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { PgPoolService } from "../storage/pg-pool.service";
import { CreateEndpointDto, type CreateEndpointResult } from "./dto/create-endpoint.dto";
import {
  CreateEnrollmentKeyDto,
  type CreateEnrollmentKeyResult,
} from "./dto/create-enrollment-key.dto";
import {
  CreateInstallerBundleDto,
  type CreateInstallerBundleResult,
  type InstallerOs,
} from "./dto/create-installer-bundle.dto";

function newOpaqueToken(): string {
  return randomBytes(24).toString("base64url");
}
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type BundleDownload = {
  filename: string;
  contentType: string;
  content: string;
};

type FileDownload = {
  filename: string;
  contentType: string;
  absPath: string;
};

@Injectable()
export class ProvisioningService {
  constructor(private readonly pg: PgPoolService) { }

  // ────────────────────────────────────────────────────────────────────────────
  // Existing: one-time endpoint enrollments
  // ────────────────────────────────────────────────────────────────────────────
  async createEndpoint(dto: CreateEndpointDto): Promise<CreateEndpointResult> {
    const clientId = String(dto.clientId ?? "").trim();
    const siteId = String(dto.siteId ?? "").trim();
    const deviceId = String(dto.deviceId ?? "").trim();
    const os = dto.os;
    const alias = String(dto.alias ?? "").trim();
    const expiresMinutes = Number.isFinite(dto.expiresMinutes as any)
      ? Number(dto.expiresMinutes)
      : 30;

    if (!clientId) throw new BadRequestException("clientId is required");
    if (!siteId) throw new BadRequestException("siteId is required");
    if (!deviceId) throw new BadRequestException("deviceId is required");
    if (!alias) throw new BadRequestException("alias is required");
    if (!(expiresMinutes >= 1 && expiresMinutes <= 1440)) {
      throw new BadRequestException("expiresMinutes must be between 1 and 1440");
    }

    // Enforce: site must belong to client
    const siteRes = await this.pg.query<{ client_id: string }>(
      `SELECT s.client_id::text AS client_id FROM public.sites s WHERE s.id = $1::uuid LIMIT 1`,
      [siteId]
    );
    const siteClientId = siteRes.rows[0]?.client_id ?? null;
    if (!siteClientId) throw new NotFoundException("Site not found");
    if (siteClientId !== clientId) {
      throw new BadRequestException("Site does not belong to the selected client");
    }

    // Create device row if missing (FK for agents.device_id requires this)
    await this.pg.query(
      `
      INSERT INTO public.devices (id, site_id, hostname, alias, operating_system, architecture, status, last_seen_at, created_at, updated_at)
      VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, NULL, 'offline'::device_status, NULL, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE
      SET site_id = EXCLUDED.site_id,
          alias = EXCLUDED.alias,
          operating_system = EXCLUDED.operating_system,
          updated_at = NOW()
      `,
      [deviceId, siteId, alias, alias, os]
    );

    // Generate one-time token and store hash
    const enrollmentSecret = newOpaqueToken();
    const tokenHash = hashToken(enrollmentSecret);

    const { rows } = await this.pg.query<{ expires_at: string }>(
      `
      INSERT INTO public.endpoint_enrollments
        (client_id, site_id, device_id, os, alias, token_hash, expires_at, used_at, created_at, updated_at)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, NOW() + ($7::text || ' minutes')::interval, NULL, NOW(), NOW())
      RETURNING expires_at
      `,
      [clientId, siteId, deviceId, os, alias, tokenHash, String(expiresMinutes)]
    );

    const expiresAtIso = rows[0]?.expires_at
      ? new Date(rows[0].expires_at).toISOString()
      : new Date(Date.now() + expiresMinutes * 60_000).toISOString();

    return {
      deviceId,
      enrollmentSecret,
      expiresAt: expiresAtIso,
      clientId,
      siteId,
      os,
      alias,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Existing: reusable site enrollment keys
  // ────────────────────────────────────────────────────────────────────────────
  async createEnrollmentKey(
    dto: CreateEnrollmentKeyDto,
    createdByUserId: string | null
  ): Promise<CreateEnrollmentKeyResult> {
    const clientId = String(dto.clientId ?? "").trim();
    const siteId = String(dto.siteId ?? "").trim();
    const name = dto.name != null ? String(dto.name).trim() : "";
    const expiresMinutes = Number.isFinite(dto.expiresMinutes as any)
      ? Number(dto.expiresMinutes)
      : 7 * 24 * 60;

    if (!clientId) throw new BadRequestException("clientId is required");
    if (!siteId) throw new BadRequestException("siteId is required");
    if (!(expiresMinutes >= 1 && expiresMinutes <= 43200)) {
      throw new BadRequestException("expiresMinutes must be between 1 and 43200");
    }

    // Enforce: site must belong to client
    const siteRes = await this.pg.query<{ client_id: string }>(
      `SELECT s.client_id::text AS client_id FROM public.sites s WHERE s.id = $1::uuid LIMIT 1`,
      [siteId]
    );
    const siteClientId = siteRes.rows[0]?.client_id ?? null;
    if (!siteClientId) throw new NotFoundException("Site not found");
    if (siteClientId !== clientId) {
      throw new BadRequestException("Site does not belong to the selected client");
    }

    const enrollmentKey = newOpaqueToken();
    const tokenHash = hashToken(enrollmentKey);
    const tokenId = randomUUID();

    const { rows } = await this.pg.query<{ expires_at: string }>(
      `
      INSERT INTO public.site_enrollment_keys
        (id, client_id, site_id, name, token_hash, expires_at, revoked_at, last_used_at, created_by_user_id, created_at, updated_at)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, NULLIF($4::text, ''), $5::text, NOW() + ($6::text || ' minutes')::interval, NULL, NULL, $7::uuid, NOW(), NOW())
      RETURNING expires_at
      `,
      [tokenId, clientId, siteId, name, tokenHash, String(expiresMinutes), createdByUserId]
    );

    const expiresAtIso = rows[0]?.expires_at
      ? new Date(rows[0].expires_at).toISOString()
      : new Date(Date.now() + expiresMinutes * 60_000).toISOString();

    return {
      enrollmentKey,
      tokenId,
      expiresAt: expiresAtIso,
      clientId,
      siteId,
      name: name || null,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Installer bundles
  // ────────────────────────────────────────────────────────────────────────────

  private async ensureInstallerBundlesTable(): Promise<void> {
    await this.pg.query(`
      CREATE TABLE IF NOT EXISTS public.installer_bundles (
        id uuid PRIMARY KEY,
        client_id uuid NOT NULL,
        site_id uuid NOT NULL,
        os text NOT NULL,
        filename text NOT NULL,
        content text NOT NULL,
        download_token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT NOW()
      );
    `);

    await this.pg.query(`
      CREATE INDEX IF NOT EXISTS installer_bundles_expires_at_idx
      ON public.installer_bundles (expires_at);
    `);
  }

  private async validateReusableEnrollmentKey(
    rawEnrollmentKey: string
  ): Promise<{ clientId: string; siteId: string }> {
    const key = String(rawEnrollmentKey ?? "").trim();
    if (!key) throw new BadRequestException("enrollmentKey is required");

    const h = hashToken(key);

    const { rows } = await this.pg.query<{ client_id: string; site_id: string }>(
      `
      SELECT
        k.client_id::text AS client_id,
        k.site_id::text AS site_id
      FROM public.site_enrollment_keys k
      WHERE k.token_hash = $1::text
        AND k.revoked_at IS NULL
        AND k.expires_at > NOW()
      LIMIT 1
      `,
      [h]
    );

    const row = rows[0];
    if (!row?.client_id || !row?.site_id) {
      throw new UnauthorizedException("Invalid, revoked, or expired enrollment key.");
    }

    return { clientId: row.client_id, siteId: row.site_id };
  }

  private resolveAgentPackagePath(os: InstallerOs): {
    absPath: string;
    filename: string;
    contentType: string;
  } {
    const baseDir = path.join(process.cwd(), "assets", "agent-packages");

    if (os === "windows") {
      const filename = "remoteiq-agent-windows.zip";
      const absPath = process.env.AGENT_PKG_WINDOWS_PATH
        ? path.resolve(process.env.AGENT_PKG_WINDOWS_PATH)
        : path.join(baseDir, "windows", filename);
      return { absPath, filename, contentType: "application/zip" };
    }

    if (os === "linux") {
      const filename = "remoteiq-agent-linux.zip";
      const absPath = process.env.AGENT_PKG_LINUX_PATH
        ? path.resolve(process.env.AGENT_PKG_LINUX_PATH)
        : path.join(baseDir, "linux", filename);
      return { absPath, filename, contentType: "application/zip" };
    }

    const filename = "remoteiq-agent-macos.zip";
    const absPath = process.env.AGENT_PKG_MACOS_PATH
      ? path.resolve(process.env.AGENT_PKG_MACOS_PATH)
      : path.join(baseDir, "macos", filename);
    return { absPath, filename, contentType: "application/zip" };
  }

  /**
   * Bootstrap installer templates:
   * - Reusable
   * - Reuse deviceId if enrollment.json already exists
   * - Windows: downloads agent package, installs service, starts service
   */
  private buildBootstrapScript(params: {
    os: InstallerOs;
    enrollmentKey: string;
    bundleId: string;
    downloadToken: string;
  }): { filename: string; contentType: string; content: string } {
    const safeKey = String(params.enrollmentKey ?? "").replace(/"/g, '\\"');
    const safeBundleId = String(params.bundleId ?? "").replace(/"/g, '\\"');
    const safeToken = String(params.downloadToken ?? "").replace(/"/g, '\\"');

    if (params.os === "windows") {
      const filename = `RemoteIQ-Installer-Windows.ps1`;

      // IMPORTANT: No PowerShell backticks (`) inside this TS template literal.
      const content = `# RemoteIQ Bootstrap Installer (Windows)
# Writes enrollment config (reusable; preserves deviceId), downloads agent package, installs service, starts service.

$ErrorActionPreference = "Stop"

# Bundle auth (short-lived)
$BundleId = "${safeBundleId}"
$DownloadToken = "${safeToken}"

# Enrollment key (site-scoped reusable)
$EnrollmentKey = "${safeKey}"

# Server base URL (script prompts if empty)
$ServerBaseUrl = ""
if ([string]::IsNullOrWhiteSpace($ServerBaseUrl)) {
  $ServerBaseUrl = Read-Host "Enter RemoteIQ Server Base URL (example: https://rmm.example.com)"
}
$ServerBaseUrl = $ServerBaseUrl.Trim().TrimEnd("/")

# Paths
$BaseDir = Join-Path $env:ProgramData "RemoteIQ"
$CfgPath = Join-Path $BaseDir "enrollment.json"

$InstallDir = Join-Path $env:ProgramFiles "RemoteIQ\\Agent"
$TempDir = Join-Path $env:TEMP "RemoteIQ"
$ZipPath = Join-Path $TempDir "agent.zip"

New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# Reuse deviceId if config already exists; otherwise generate a new GUID.
$DeviceId = $null
if (Test-Path -LiteralPath $CfgPath) {
  try {
    $existing = Get-Content -LiteralPath $CfgPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($existing -and $existing.deviceId) {
      $DeviceId = [string]$existing.deviceId
    }
  } catch {
    # ignore parse errors; we'll overwrite below
  }
}
if ([string]::IsNullOrWhiteSpace($DeviceId)) {
  $DeviceId = [Guid]::NewGuid().ToString()
}

# Write enrollment.json
$cfg = @{
  deviceId = $DeviceId
  enrollmentKey = $EnrollmentKey
} | ConvertTo-Json -Depth 6

Set-Content -Path $CfgPath -Value $cfg -Encoding UTF8

Write-Host "✅ Wrote enrollment config to: $CfgPath"
Write-Host "DeviceId: $DeviceId"
Write-Host ""

# TLS safety for older boxes
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# Download agent package
$AgentUrl = "$ServerBaseUrl/api/provisioning/installer-bundles/$BundleId/agent-package?token=$DownloadToken"
Write-Host "⬇️  Downloading agent package..."
Write-Host "URL: $AgentUrl"
Invoke-WebRequest -Uri $AgentUrl -OutFile $ZipPath -UseBasicParsing

# Extract agent
Write-Host "📦 Extracting agent to: $InstallDir"
Get-ChildItem -Path $InstallDir -Force -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
Expand-Archive -Path $ZipPath -DestinationPath $InstallDir -Force

# Find agent exe (zip should contain one of these at the root)
$AgentExe = Join-Path $InstallDir "remoteiq-agent.exe"
if (!(Test-Path $AgentExe)) {
  $alt = Join-Path $InstallDir "RemoteIQ.Agent.exe"
  if (Test-Path $alt) { $AgentExe = $alt }
}
if (!(Test-Path $AgentExe)) {
  throw "Agent executable not found. Expected remoteiq-agent.exe (or RemoteIQ.Agent.exe) in $InstallDir"
}

# Install / update Windows service (requires admin)
$ServiceName = "RemoteIQAgent"
$ServiceDisplay = "RemoteIQ Agent"
$ServiceDesc = "RemoteIQ endpoint agent"

Write-Host "🛠️  Installing Windows service: $ServiceName"

$existingSvc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingSvc) {
  if ($existingSvc.Status -eq "Running") {
    Write-Host "Stopping existing service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

# Quote the exe path without using PowerShell backticks
$binPath = '"' + $AgentExe + '"'

if ($existingSvc) {
  sc.exe config $ServiceName binPath= $binPath start= auto | Out-Null
} else {
  sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "$ServiceDisplay" | Out-Null
  sc.exe description $ServiceName "$ServiceDesc" | Out-Null
}

Write-Host "▶️  Starting service..."
Start-Service -Name $ServiceName

Write-Host ""
Write-Host "✅ RemoteIQ Agent installed and started."
Write-Host "InstallDir: $InstallDir"
Write-Host "Service: $ServiceName"
`;
      return { filename, contentType: "text/plain; charset=utf-8", content };
    }

    // linux + macos: still bootstrap-only for now
    const isMac = params.os === "macos";
    const filename = isMac ? `RemoteIQ-Installer-macOS.sh` : `RemoteIQ-Installer-Linux.sh`;
    const content = `#!/usr/bin/env bash
set -euo pipefail

# RemoteIQ Bootstrap Installer (${isMac ? "macOS" : "Linux"})
# Writes enrollment config. Reusable installer: re-runs keep the same deviceId if config already exists.

ENROLLMENT_KEY="${safeKey}"

CFG_DIR="/etc/remoteiq"
CFG_PATH="$CFG_DIR/enrollment.json"

DEVICE_ID=""
if [ -f "$CFG_PATH" ]; then
  if command -v python3 >/dev/null 2>&1; then
    DEVICE_ID="$(python3 - <<'PY'
import json
p = "/etc/remoteiq/enrollment.json"
try:
  with open(p, "r", encoding="utf-8") as f:
    d = json.load(f)
  v = str(d.get("deviceId") or "").strip()
  if v:
    print(v)
except Exception:
  pass
PY
)"
  fi
fi

if [ -z "$DEVICE_ID" ]; then
  if command -v uuidgen >/dev/null 2>&1; then
    DEVICE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  else
    DEVICE_ID="$(python3 - <<'PY'
import uuid
print(str(uuid.uuid4()))
PY
)"
  fi
fi

sudo mkdir -p "$CFG_DIR"
sudo tee "$CFG_PATH" >/dev/null <<JSON
{
  "deviceId": "$DEVICE_ID",
  "enrollmentKey": "$ENROLLMENT_KEY"
}
JSON

sudo chmod 600 "$CFG_PATH"

echo "✅ Wrote enrollment config to: $CFG_PATH"
echo "DeviceId: $DEVICE_ID"
`;
    return { filename, contentType: "text/plain; charset=utf-8", content };
  }

  async createInstallerBundle(dto: CreateInstallerBundleDto): Promise<CreateInstallerBundleResult> {
    await this.ensureInstallerBundlesTable();

    const enrollmentKey = String(dto.enrollmentKey ?? "").trim();
    const os = dto.os;

    const { clientId, siteId } = await this.validateReusableEnrollmentKey(enrollmentKey);

    // Short-lived download URL (default 10 minutes)
    const expiresMinutes = 10;
    const bundleId = randomUUID();
    const downloadToken = newOpaqueToken();
    const downloadTokenHash = hashToken(downloadToken);

    const built = this.buildBootstrapScript({
      os,
      enrollmentKey,
      bundleId,
      downloadToken,
    });

    const label = String(dto.label ?? "").trim();
    const filename = label
      ? built.filename.replace(
        /RemoteIQ-Installer/,
        `RemoteIQ-Installer-${label.replace(/[^a-zA-Z0-9-_]+/g, "-")}`
      )
      : built.filename;

    await this.pg.query(
      `
      INSERT INTO public.installer_bundles
        (id, client_id, site_id, os, filename, content, download_token_hash, expires_at, created_at)
      VALUES
        ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text, NOW() + ($8::text || ' minutes')::interval, NOW())
      `,
      [bundleId, clientId, siteId, os, filename, built.content, downloadTokenHash, String(expiresMinutes)]
    );

    const url = `/api/provisioning/installer-bundles/${encodeURIComponent(
      bundleId
    )}/download?token=${encodeURIComponent(downloadToken)}`;
    const expiresAt = new Date(Date.now() + expiresMinutes * 60_000).toISOString();

    return { bundleId, url, filename, expiresAt, os, clientId, siteId };
  }

  async getInstallerBundleDownload(bundleId: string, token?: string): Promise<BundleDownload> {
    const id = String(bundleId ?? "").trim();
    if (!id) throw new BadRequestException("bundle id is required");

    const raw = String(token ?? "").trim();
    if (!raw) throw new UnauthorizedException("Missing download token.");

    const h = hashToken(raw);

    const { rows } = await this.pg.query<{ filename: string; content: string }>(
      `
      SELECT b.filename::text AS filename, b.content::text AS content
      FROM public.installer_bundles b
      WHERE b.id = $1::uuid
        AND b.download_token_hash = $2::text
        AND b.expires_at > NOW()
      LIMIT 1
      `,
      [id, h]
    );

    const row = rows[0];
    if (!row?.filename || row.content == null) {
      throw new NotFoundException("Installer bundle not found, expired, or token invalid.");
    }

    return {
      filename: row.filename,
      contentType: "text/plain; charset=utf-8",
      content: row.content,
    };
  }

  async getInstallerBundleAgentPackageDownload(bundleId: string, token?: string): Promise<FileDownload> {
    const id = String(bundleId ?? "").trim();
    if (!id) throw new BadRequestException("bundle id is required");

    const raw = String(token ?? "").trim();
    if (!raw) throw new UnauthorizedException("Missing download token.");

    const h = hashToken(raw);

    const { rows } = await this.pg.query<{ os: string }>(
      `
      SELECT b.os::text AS os
      FROM public.installer_bundles b
      WHERE b.id = $1::uuid
        AND b.download_token_hash = $2::text
        AND b.expires_at > NOW()
      LIMIT 1
      `,
      [id, h]
    );

    const os = String(rows[0]?.os ?? "").trim() as InstallerOs;
    if (os !== "windows" && os !== "linux" && os !== "macos") {
      throw new NotFoundException("Installer bundle not found, expired, or token invalid.");
    }

    const pkg = this.resolveAgentPackagePath(os);

    // NOTE: Do NOT annotate the stat result as fs.Stats. Some setups/type stubs
    // can cause mismatches (like the error you saw). Let TS infer it.
    let st: any;
    try {
      st = await fs.promises.stat(pkg.absPath);
    } catch {
      throw new NotFoundException(`Agent package not found on server for os=${os}`);
    }

    if (!st || typeof st.isFile !== "function" || !st.isFile()) {
      throw new NotFoundException(`Agent package path is not a file for os=${os}`);
    }

    return { filename: pkg.filename, contentType: pkg.contentType, absPath: pkg.absPath };
  }
}
