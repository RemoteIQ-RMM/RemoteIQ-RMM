// backend/src/jobs/runs.controller.ts
import {
    Body,
    Controller,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    Post,
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import { RunsService } from "./runs.service";
import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Transform } from "class-transformer";
import { RequirePerm } from "../auth/require-perm.decorator";

class RunScriptDto {
    @IsString()
    deviceId!: string;

    @IsString()
    script!: string;

    @IsOptional()
    @IsIn(["powershell", "bash", "cmd"])
    shell?: "powershell" | "bash" | "cmd";

    @IsOptional()
    @IsInt()
    @Min(1)
    @Transform(({ value }) => (value != null ? parseInt(value, 10) : undefined))
    timeoutSec?: number;
}

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller("/api/automation")
export class RunsController {
    constructor(private readonly runs: RunsService) { }

    /**
     * Start a new automation run.
     * Returns { jobId } and uses 202 Accepted for async work.
     */
    @Post("runs")
    @HttpCode(202)
    @RequirePerm("automation.run")
    async start(@Body() body: RunScriptDto): Promise<{ jobId: string }> {
        const jobId = await this.runs.startRun(body);
        return { jobId };
    }

    /**
     * Get the *full* job snapshot (status, log, times, exitCode).
     */
    @Get("runs/:jobId")
    @RequirePerm("automation.read")
    async getSnapshot(@Param("jobId") jobId: string): Promise<ReturnType<RunsService["get"]>> {
        const snap = this.runs.get(jobId);
        if (!snap) throw new NotFoundException("Job not found");
        return snap;
    }

    /**
     * Get just the job logs (kept for compatibility with your current UI).
     */
    @Get("runs/:jobId/log")
    @RequirePerm("automation.read")
    async log(@Param("jobId") jobId: string): Promise<{ jobId: string; log: string }> {
        const snap = this.runs.get(jobId);
        if (!snap) throw new NotFoundException("Job not found");
        return { jobId, log: snap.log };
    }
}
