// backend/src/devices/device-files.controller.ts
import {
    BadRequestException,
    Controller,
    Get,
    NotFoundException,
    Param,
    Post,
    Query,
    Body,
    UsePipes,
    ValidationPipe,
    GatewayTimeoutException,
} from "@nestjs/common";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Transform } from "class-transformer";

import { PgPoolService } from "../storage/pg-pool.service";
import { JobsService } from "../jobs/jobs.service";
import { DevicesService } from "./devices.service";
import { RequirePerm } from "../auth/require-perm.decorator";

function toBool(v: any): boolean | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y" || s === "on") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n" || s === "off") return false;
    return undefined;
}

function toInt(v: any): number | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : undefined;
}

class WaitQueryDto {
    @IsOptional()
    @Transform(({ value }) => toBool(value))
    @IsBoolean()
    wait?: boolean;
}

class ListQueryDto extends WaitQueryDto {
    @IsString()
    path!: string;

    @IsOptional()
    @Transform(({ value }) => toBool(value))
    @IsBoolean()
    recursive?: boolean;
}

class ReadQueryDto extends WaitQueryDto {
    @IsString()
    path!: string;

    @IsOptional()
    @Transform(({ value }) => toInt(value))
    @IsInt()
    @Min(1)
    @Max(50 * 1024 * 1024)
    maxBytes?: number;
}

class WriteBodyDto {
    @IsString()
    path!: string;

    @IsString()
    contentBase64!: string;

    @IsOptional()
    @Transform(({ value }) => toBool(value))
    @IsBoolean()
    wait?: boolean;
}

class MkdirBodyDto {
    @IsString()
    path!: string;

    @IsOptional()
    @Transform(({ value }) => toBool(value))
    @IsBoolean()
    wait?: boolean;
}

class DeleteBodyDto {
    @IsString()
    path!: string;

    @IsOptional()
    @Transform(({ value }) => toBool(value))
    @IsBoolean()
    recursive?: boolean;

    @IsOptional()
    @Transform(({ value }) => toBool(value))
    @IsBoolean()
    wait?: boolean;
}

class MoveCopyBodyDto {
    @IsString()
    from!: string;

    @IsString()
    to!: string;

    @IsOptional()
    @Transform(({ value }) => toBool(value))
    @IsBoolean()
    recursive?: boolean; // used for copy

    @IsOptional()
    @Transform(({ value }) => toBool(value))
    @IsBoolean()
    wait?: boolean;
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

@Controller("/api/devices/:id/files")
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DeviceFilesController {
    constructor(
        private readonly pg: PgPoolService,
        private readonly jobs: JobsService,
        private readonly devices: DevicesService
    ) { }

    private async resolveAgentSelectorForDevice(
        deviceId: string
    ): Promise<{ agentUuid?: string; agentId?: string }> {
        const dev = await this.devices.getOne(deviceId);
        if (!dev) throw new NotFoundException("Device not found");

        const agentUuid = String((dev as any).agentUuid ?? "").trim();
        if (agentUuid) return { agentUuid };

        const { rows } = await this.pg.query<{ agent_uuid: string | null; id: string }>(
            `SELECT agent_uuid::text AS agent_uuid, id::text AS id
         FROM public.agents
        WHERE device_id::text = $1
        LIMIT 1`,
            [String(deviceId)]
        );

        const r = rows[0];
        if (!r) throw new NotFoundException("No agent enrolled for this device");

        const au = String(r.agent_uuid ?? "").trim();
        if (au) return { agentUuid: au };

        return { agentId: String(r.id) };
    }

    private async waitForJob(jobId: string, timeoutMs = 15000, pollMs = 250) {
        const deadline = Date.now() + Math.max(1000, timeoutMs);

        while (Date.now() < deadline) {
            const j = await this.jobs.getJobWithResult(jobId);
            const status = String(j.status ?? "").toLowerCase();

            if (status === "succeeded" || status === "failed" || status === "timeout") {
                return j;
            }

            await sleep(pollMs);
        }

        throw new GatewayTimeoutException("Timed out waiting for agent job result");
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // Roots (drives)
    // ──────────────────────────────────────────────────────────────────────────────

    @Get("/roots")
    @RequirePerm("devices.read")
    async roots(@Param("id") id: string, @Query() q: WaitQueryDto) {
        const sel = await this.resolveAgentSelectorForDevice(id);

        const job = await this.jobs.createFileOpJob({
            ...sel,
            op: "roots",
        });

        if (q.wait) return this.waitForJob(job.id, 15000, 250);
        return job;
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // Read ops
    // ──────────────────────────────────────────────────────────────────────────────

    @Get()
    @RequirePerm("devices.read")
    async list(@Param("id") id: string, @Query() q: ListQueryDto) {
        const sel = await this.resolveAgentSelectorForDevice(id);

        const job = await this.jobs.createFileOpJob({
            ...sel,
            op: "list",
            path: q.path,
            recursive: !!q.recursive,
        });

        if (q.wait) return this.waitForJob(job.id, 20000, 250);
        return job;
    }

    @Get("/read")
    @RequirePerm("devices.read")
    async read(@Param("id") id: string, @Query() q: ReadQueryDto) {
        const sel = await this.resolveAgentSelectorForDevice(id);

        const job = await this.jobs.createFileOpJob({
            ...sel,
            op: "read",
            path: q.path,
            maxBytes: q.maxBytes,
        });

        if (q.wait) return this.waitForJob(job.id, 20000, 250);
        return job;
    }

    // ──────────────────────────────────────────────────────────────────────────────
    // Write ops
    // ──────────────────────────────────────────────────────────────────────────────

    @Post("/write")
    @RequirePerm("devices.actions")
    async write(@Param("id") id: string, @Body() body: WriteBodyDto) {
        const sel = await this.resolveAgentSelectorForDevice(id);

        const job = await this.jobs.createFileOpJob({
            ...sel,
            op: "write",
            path: body.path,
            contentBase64: body.contentBase64,
        });

        if (body.wait) return this.waitForJob(job.id, 20000, 250);
        return job;
    }

    @Post("/mkdir")
    @RequirePerm("devices.actions")
    async mkdir(@Param("id") id: string, @Body() body: MkdirBodyDto) {
        const sel = await this.resolveAgentSelectorForDevice(id);

        const job = await this.jobs.createFileOpJob({
            ...sel,
            op: "mkdir",
            path: body.path,
        });

        if (body.wait) return this.waitForJob(job.id, 20000, 250);
        return job;
    }

    @Post("/delete")
    @RequirePerm("devices.actions")
    async del(@Param("id") id: string, @Body() body: DeleteBodyDto) {
        const sel = await this.resolveAgentSelectorForDevice(id);

        const job = await this.jobs.createFileOpJob({
            ...sel,
            op: "delete",
            path: body.path,
            recursive: !!body.recursive,
        });

        if (body.wait) return this.waitForJob(job.id, 20000, 250);
        return job;
    }

    @Post("/move")
    @RequirePerm("devices.actions")
    async move(@Param("id") id: string, @Body() body: MoveCopyBodyDto) {
        const sel = await this.resolveAgentSelectorForDevice(id);

        const from = String(body.from ?? "").trim();
        const to = String(body.to ?? "").trim();
        if (!from || !to) throw new BadRequestException("from and to are required");

        const job = await this.jobs.createFileOpJob({
            ...sel,
            op: "move",
            path: from,
            path2: to,
        });

        if (body.wait) return this.waitForJob(job.id, 20000, 250);
        return job;
    }

    @Post("/copy")
    @RequirePerm("devices.actions")
    async copy(@Param("id") id: string, @Body() body: MoveCopyBodyDto) {
        const sel = await this.resolveAgentSelectorForDevice(id);

        const from = String(body.from ?? "").trim();
        const to = String(body.to ?? "").trim();
        if (!from || !to) throw new BadRequestException("from and to are required");

        const job = await this.jobs.createFileOpJob({
            ...sel,
            op: "copy",
            path: from,
            path2: to,
            recursive: !!body.recursive,
        });

        if (body.wait) return this.waitForJob(job.id, 20000, 250);
        return job;
    }
}
