// backend/src/devices/device-actions.controller.ts
import {
    Body,
    Controller,
    HttpCode,
    NotFoundException,
    Param,
    Post,
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";

import { JobsService } from "../jobs/jobs.service";
import { PgPoolService } from "../storage/pg-pool.service";
import { RequirePerm } from "../auth/require-perm.decorator";
import { UninstallSoftwareDto } from "./dto/uninstall-software.dto";

class ActionRequestDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}

type ActionResponse = { accepted: true; jobId: string };

/**
 * Resolve an agent id for actions.
 * Accepts:
 * - agents.id (preferred)
 * - devices.id (public.devices.id) -> lookup agents.device_id
 */
async function resolveAgentIdOrThrow(pg: PgPoolService, id: string): Promise<string> {
    const key = String(id ?? "").trim();
    if (!key) throw new NotFoundException("Missing device id");

    // 1) If the id is already an agent id, accept it.
    const asAgent = await pg.query<{ id: string }>(
        `SELECT a.id::text AS id FROM public.agents a WHERE a.id::text = $1 LIMIT 1`,
        [key]
    );
    if (asAgent.rows[0]?.id) return asAgent.rows[0].id;

    // 2) Otherwise treat it as device id -> find agent by device_id
    const byDevice = await pg.query<{ id: string }>(
        `SELECT a.id::text AS id FROM public.agents a WHERE a.device_id::text = $1 LIMIT 1`,
        [key]
    );
    if (byDevice.rows[0]?.id) return byDevice.rows[0].id;

    // No connected agent for this device
    throw new NotFoundException("Agent not connected for this device");
}

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller("/api/devices/:id/actions")
export class DeviceActionsController {
    constructor(private readonly jobs: JobsService, private readonly pg: PgPoolService) { }

    @Post("reboot")
    @RequirePerm("devices.actions")
    @HttpCode(202)
    async reboot(@Param("id") id: string, @Body() _body: ActionRequestDto): Promise<ActionResponse> {
        const agentId = await resolveAgentIdOrThrow(this.pg, id);

        const job = await this.jobs.createRunScriptJob({
            agentId,
            language: "powershell",
            scriptText: 'Start-Process "shutdown" -ArgumentList "/r /t 5" -Verb RunAs',
            timeoutSec: 60,
        });

        return { accepted: true, jobId: job.id };
    }

    @Post("patch")
    @RequirePerm("devices.actions")
    @HttpCode(202)
    async patch(@Param("id") id: string, @Body() _body: ActionRequestDto): Promise<ActionResponse> {
        const agentId = await resolveAgentIdOrThrow(this.pg, id);

        const job = await this.jobs.createRunScriptJob({
            agentId,
            language: "powershell",
            scriptText:
                'Install-Module PSWindowsUpdate -Force -Scope CurrentUser; Import-Module PSWindowsUpdate; Get-WindowsUpdate -AcceptAll -Install -AutoReboot',
            timeoutSec: 15 * 60,
        });

        return { accepted: true, jobId: job.id };
    }

    @Post("uninstall")
    @RequirePerm("devices.actions")
    @HttpCode(202)
    async uninstall(
        @Param("id") id: string,
        @Body() body: UninstallSoftwareDto
    ): Promise<ActionResponse> {
        if (!body?.name) throw new NotFoundException("Missing software name");

        const agentId = await resolveAgentIdOrThrow(this.pg, id);

        const ps = `
$ErrorActionPreference = 'Stop'
$targetName = ${JSON.stringify(body.name)}
$apps = @()
$apps += Get-ItemProperty "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -ErrorAction SilentlyContinue
$apps += Get-ItemProperty "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*" -ErrorAction SilentlyContinue
$target = $apps | Where-Object { $_.DisplayName -eq $targetName } | Select-Object -First 1
if (-not $target) { Write-Error "App not found: $targetName"; exit 2 }
$uninstall = $target.UninstallString
if (-not $uninstall) { Write-Error "No uninstall string found for $targetName"; exit 3 }
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $uninstall -Wait -NoNewWindow -PassThru | Out-Null
exit $LASTEXITCODE
    `.trim();

        const job = await this.jobs.createRunScriptJob({
            agentId,
            language: "powershell",
            scriptText: ps,
            timeoutSec: 30 * 60,
        });

        return { accepted: true, jobId: job.id };
    }
}
