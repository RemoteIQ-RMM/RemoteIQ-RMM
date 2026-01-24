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
  Req,
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

/**
 * Matches your frontend expectations (components/checks-and-alerts-tab.tsx)
 * plus optional augmented fields.
 */
type DeviceCheckDto = {
  id: string;
  name: string;
  status: "Passing" | "Failing" | "Warning";
  lastRun?: string | null;
  output?: string | null;

  // optional extras if present in DB
  type?: string | null;
  severity?: string | null;
  category?: string | null;
  tags?: string[] | null;
  thresholds?: Record<string, any> | null;
  metrics?: Record<string, any> | null;
  maintenance?: boolean | null;
  dedupeKey?: string | null;
};

type ChecksSource = {
  table: string; // public.<table>
  deviceCol: string; // column used to filter by device id
  columns: Set<string>;
};

// Cache the discovered checks source (so we don’t hit information_schema every request)
let CACHED_CHECKS_SOURCE: ChecksSource | null = null;

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

  /**
   * ✅ Checks & Alerts
   * This endpoint is what your UI calls:
   * GET /api/devices/:id/checks
   *
   * It is schema-tolerant and will return { items: [] } if checks tables/columns
   * aren’t available yet, preventing a 500.
   */
  @Get(":id/checks")
  @RequirePerm("devices.read")
  async checks(@Param("id") id: string): Promise<{ items: DeviceCheckDto[] }> {
    // Ensure device exists (clean 404 instead of weird downstream issues)
    const dev = await this.devices.getOne(id);
    if (!dev) throw new NotFoundException("Device not found");

    try {
      const source = await this.getChecksSource();
      if (!source) return { items: [] };

      const cols = source.columns;

      const pick = (...names: string[]) => names.find((n) => cols.has(n)) ?? null;

      const idCol = pick("id", "check_id", "result_id") ?? "id";
      const nameCol = pick("name", "check_name", "title") ?? "name";
      const statusCol = pick("status", "result_status", "state") ?? "status";
      const lastRunCol = pick("last_run", "lastRun", "ran_at", "ranAt", "created_at", "createdAt", "updated_at", "updatedAt");
      const outputCol = pick("output", "message", "details", "result", "stdout", "stderr");

      const typeCol = pick("type");
      const severityCol = pick("severity");
      const categoryCol = pick("category");
      const tagsCol = pick("tags");
      const thresholdsCol = pick("thresholds");
      const metricsCol = pick("metrics");
      const maintenanceCol = pick("maintenance");
      const dedupeKeyCol = pick("dedupe_key", "dedupeKey");

      // Build SELECT list using only available columns
      const selectParts: string[] = [];

      // required-ish fields for UI; fallback to constants if missing
      selectParts.push(`COALESCE("${idCol}"::text, '') AS "id"`);
      selectParts.push(`COALESCE("${nameCol}"::text, 'Unnamed Check') AS "name"`);
      selectParts.push(`COALESCE("${statusCol}"::text, 'Passing') AS "status"`);

      if (lastRunCol) selectParts.push(`"${lastRunCol}"::text AS "lastRun"`);
      else selectParts.push(`NULL::text AS "lastRun"`);

      if (outputCol) selectParts.push(`"${outputCol}"::text AS "output"`);
      else selectParts.push(`NULL::text AS "output"`);

      if (typeCol) selectParts.push(`"${typeCol}"::text AS "type"`);
      else selectParts.push(`NULL::text AS "type"`);

      if (severityCol) selectParts.push(`"${severityCol}"::text AS "severity"`);
      else selectParts.push(`NULL::text AS "severity"`);

      if (categoryCol) selectParts.push(`"${categoryCol}"::text AS "category"`);
      else selectParts.push(`NULL::text AS "category"`);

      // tags (jsonb/array/string tolerant)
      if (tagsCol) {
        // If tags is json/jsonb array: use as-is; if text, wrap to single item
        selectParts.push(`
          CASE
            WHEN pg_typeof("${tagsCol}")::text IN ('jsonb','json') THEN "${tagsCol}"
            WHEN pg_typeof("${tagsCol}")::text LIKE '%[]' THEN to_jsonb("${tagsCol}")
            WHEN "${tagsCol}" IS NULL THEN NULL
            ELSE to_jsonb(ARRAY["${tagsCol}"::text])
          END AS "tags"
        `.trim());
      } else {
        selectParts.push(`NULL::jsonb AS "tags"`);
      }

      if (thresholdsCol) selectParts.push(`"${thresholdsCol}"::jsonb AS "thresholds"`);
      else selectParts.push(`NULL::jsonb AS "thresholds"`);

      if (metricsCol) selectParts.push(`"${metricsCol}"::jsonb AS "metrics"`);
      else selectParts.push(`NULL::jsonb AS "metrics"`);

      if (maintenanceCol) selectParts.push(`"${maintenanceCol}"::boolean AS "maintenance"`);
      else selectParts.push(`NULL::boolean AS "maintenance"`);

      if (dedupeKeyCol) selectParts.push(`"${dedupeKeyCol}"::text AS "dedupeKey"`);
      else selectParts.push(`NULL::text AS "dedupeKey"`);

      const orderCol = lastRunCol ?? pick("created_at", "createdAt", "updated_at", "updatedAt") ?? null;
      const orderBy = orderCol ? `"${orderCol}" DESC NULLS LAST` : `"${idCol}" DESC`;

      const sql = `
        SELECT
          ${selectParts.join(",\n          ")}
        FROM ${source.table}
        WHERE "${source.deviceCol}"::text = $1
        ORDER BY ${orderBy}
        LIMIT 500
      `;

      const { rows } = await this.pg.query<any>(sql, [String(id)]);

      const items: DeviceCheckDto[] = (rows ?? []).map((r: any) => ({
        id: String(r.id ?? ""),
        name: String(r.name ?? "Unnamed Check"),
        status: normalizeCheckStatus(String(r.status ?? "Passing")),
        lastRun: r.lastRun ?? null,
        output: r.output ?? null,

        type: r.type ?? null,
        severity: r.severity ?? null,
        category: r.category ?? null,
        tags: normalizeTags(r.tags),
        thresholds: r.thresholds ?? null,
        metrics: r.metrics ?? null,
        maintenance: typeof r.maintenance === "boolean" ? r.maintenance : null,
        dedupeKey: r.dedupeKey ?? null,
      }));

      return { items };
    } catch (e: any) {
      // If schema isn't ready or tables don’t exist yet, don’t 500 the UI.
      // Still log so you can see the real issue in backend logs.
      // eslint-disable-next-line no-console
      console.warn("[devices.checks] returning empty due to error:", e?.message ?? e);
      return { items: [] };
    }
  }

  @Post(":id/deletion-requests")
  @RequirePerm("devices.read")
  @HttpCode(202)
  async requestDeletion(@Req() req: any, @Param("id") id: string) {
    const userId = req?.user?.id ? String(req.user.id) : null;
    return await this.devices.requestDeviceDeletion(id, userId);
  }

  @Post(":id/deletion-requests/approve")
  @RequirePerm("devices.delete")
  async approveDeletion(@Req() req: any, @Param("id") id: string) {
    const userId = req?.user?.id ? String(req.user.id) : null;
    return await this.devices.approveAndDeleteDevice(id, userId);
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

  /**
   * Detects a checks/results table at runtime and caches it.
   * This prevents hardcoding a schema while you're still building it.
   */
  private async getChecksSource(): Promise<ChecksSource | null> {
    if (CACHED_CHECKS_SOURCE) return CACHED_CHECKS_SOURCE;

    // Common candidates (add/remove as your schema evolves)
    const candidates = [
      "device_checks",
      "device_check_results",
      "check_results",
      "checks_results",
      "checks",
      "alerts",
      "device_alerts",
    ];

    // Find first existing table
    let tableName: string | null = null;
    for (const t of candidates) {
      const { rows } = await this.pg.query<{ exists: boolean }>(
        `
        SELECT EXISTS(
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema='public' AND table_name=$1
        ) AS "exists"
        `,
        [t]
      );
      if (rows?.[0]?.exists) {
        tableName = t;
        break;
      }
    }

    if (!tableName) return null;

    const { rows: colRows } = await this.pg.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      `,
      [tableName]
    );

    const columns = new Set((colRows ?? []).map((r) => r.column_name));

    // Identify device FK column
    const deviceCol =
      columns.has("device_id") ? "device_id"
        : columns.has("deviceId") ? "deviceId"
          : columns.has("device_uuid") ? "device_uuid"
            : columns.has("deviceUuid") ? "deviceUuid"
              : columns.has("device") ? "device"
                : null;

    if (!deviceCol) {
      // no usable FK column; don’t cache (so you can fix schema and it’ll re-detect)
      // eslint-disable-next-line no-console
      console.warn(`[devices.checks] Found table "${tableName}" but no device FK column; returning empty until schema is updated.`);
      return null;
    }

    CACHED_CHECKS_SOURCE = {
      table: `"public"."${tableName}"`,
      deviceCol,
      columns,
    };

    return CACHED_CHECKS_SOURCE;
  }
}

function normalizeCheckStatus(raw: string): "Passing" | "Failing" | "Warning" {
  const s = (raw || "").toLowerCase().trim();
  if (s === "failing" || s === "fail" || s === "failed" || s === "critical" || s === "crit") return "Failing";
  if (s === "warning" || s === "warn") return "Warning";
  return "Passing";
}

function normalizeTags(v: any): string[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(String);
  // jsonb array may come as object/array depending on pg config; try best effort
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* ignore */ }
    return [s];
  }
  return null;
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
