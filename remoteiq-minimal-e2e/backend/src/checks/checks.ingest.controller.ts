// backend/src/checks/checks.ingest.controller.ts
import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { IsArray, IsObject, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ChecksRuntimeService } from "./checks.runtime.service";

/* ----------------------------- DTOs (light) ----------------------------- */

class RunDto {
    @IsOptional() @IsString() assignmentId?: string;
    @IsOptional() @IsString() dedupeKey?: string;
    @IsOptional() @IsString() checkType?: string;
    @IsOptional() @IsString() checkName?: string;

    @IsString() status!: string;
    @IsOptional() @IsString() severity?: "WARN" | "CRIT";

    @IsOptional() @IsObject() metrics?: Record<string, any>;
    @IsOptional() @IsString() output?: string;
    @IsOptional() @IsString() startedAt?: string;
    @IsOptional() @IsString() finishedAt?: string;
}

class IngestBodyDto {
    @IsString() deviceId!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RunDto)
    runs!: RunDto[];
}

/* -------------------------------- Helper -------------------------------- */

function extractAgentId(req: Request): string {
    // Priority 1: Authorization: Bearer <agentId>
    const authRaw =
        (req.headers["authorization"] as string | undefined) ||
        (req.headers["Authorization"] as unknown as string | undefined);

    if (authRaw && typeof authRaw === "string") {
        const m = authRaw.match(/^Bearer\s+(.+)$/i);
        if (m && m[1]) return m[1].trim();
    }

    // Priority 2 (dev): x-agent-id header when AGENT_DEV_BYPASS=1
    const devBypass = process.env.AGENT_DEV_BYPASS === "1";
    const headerAgent = (req.headers["x-agent-id"] as string | undefined)?.trim();
    if (devBypass && headerAgent) return headerAgent;

    throw new UnauthorizedException("Missing Authorization header");
}

/* ----------------------------- Controller ------------------------------- */

@Controller("api/agent")
export class ChecksIngestController {
    constructor(private readonly checks: ChecksRuntimeService) { }

    /**
     * POST /api/agent/check-runs
     * Accepts batched check run payloads from agents.
     *
     * Auth:
     *  - Production: "Authorization: Bearer <agentId>"
     *  - Dev (set AGENT_DEV_BYPASS=1): optionally use "x-agent-id: <agentId>"
     */
    @Post("check-runs")
    @HttpCode(HttpStatus.CREATED)
    async postCheckRuns(@Req() req: Request, @Body() body: IngestBodyDto) {
        const agentId = extractAgentId(req);

        // Delegate to runtime service (which normalizes, upserts assignments and inserts runs)
        const result = await this.checks.ingestAgentRuns({
            agentId,
            deviceId: body.deviceId,
            runs: body.runs.map((r) => ({
                assignmentId: r.assignmentId,
                dedupeKey: r.dedupeKey,
                checkType: r.checkType,
                checkName: r.checkName,
                status: r.status,
                severity: r.severity,
                metrics: r.metrics,
                output: r.output,
                startedAt: r.startedAt,
                finishedAt: r.finishedAt,
            })),
        });

        // 201 with simple counts
        return result; // { inserted, assignmentsCreated }
    }
}
