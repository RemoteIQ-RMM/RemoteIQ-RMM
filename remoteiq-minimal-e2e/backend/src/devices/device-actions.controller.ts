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
import { JobsService } from "../jobs/jobs.service";
import { PgPoolService } from "../storage/pg-pool.service";
import { UninstallSoftwareDto } from "./dto/uninstall-software.dto";
import { RequirePerm } from "../auth/require-perm.decorator";

class ActionRequestDto {
    reason?: string;
}

type ActionResponse = { accepted: true; jobId: string };

async function resolveAgentIdOrThrow(pg: PgPoolService, id: string): Promise<string> {
    const key = String(id);
    const { rows } = await pg.query<{ agent_id: string }>(
        `SELECT agent_id FROM devices WHERE id = $1 LIMIT 1`,
        [key]
    );
    if (rows.length && rows[0]?.agent_id) {
        return String(rows[0].agent_id);
    }
    return key;
}

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller("/api/devices/:id/actions")
export class DeviceActionsController {
    constructor(private readonly jobs: JobsService, private readonly pg: PgPoolService) { }

    @Post("reboot")
    @RequirePerm("devices.actions")
    @HttpCode(202)
    async reboot(@Param("id") id: string, @Body() _body: ActionRequestDto): Promise<ActionResponse> {
        if (!id) throw new NotFoundException("Missing device id");
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
        if (!id) throw new NotFoundException("Missing device id");
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
    async uninstall(@Param("id") id: string, @Body() body: UninstallSoftwareDto): Promise<ActionResponse> {
        if (!id) throw new NotFoundException("Missing device id");
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
