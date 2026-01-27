// backend/src/agents/agents.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Public } from "../auth/public.decorator";
import { AuthService } from "../auth/auth.service";
import { ChecksService } from "../checks/checks.service";
import { AgentTokenGuard, getAgentFromRequest } from "../common/agent-token.util";
import { AgentsService } from "./agents.service";
import { AgentsTasksService } from "./agents.tasks.service";
import { EnrollAgentDto } from "./dto/enroll-agent.dto";
import { SubmitSoftwareDto } from "./dto/submit-software.dto";
import { UpdateAgentFactsDto } from "./dto/update-agent-facts.dto";

/* ----------------------------- DTOs for runs ----------------------------- */

export enum AgentRunStatus {
  OK = "OK",
  PASS = "PASS",
  PASSING = "PASSING",
  WARN = "WARN",
  WARNING = "WARNING",
  CRIT = "CRIT",
  ERROR = "ERROR",
  FAIL = "FAIL",
  FAILING = "FAILING",
  TIMEOUT = "TIMEOUT",
  UNKNOWN = "UNKNOWN",
}

export class SubmitCheckRunItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(36)
  assignmentId?: string; // uuid string (not strictly validated to allow empty envs)

  @IsOptional()
  @IsString()
  @MaxLength(256)
  dedupeKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  checkType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  checkName?: string;

  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  severity?: "WARN" | "CRIT";

  @IsOptional()
  @IsObject()
  metrics?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  output?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  finishedAt?: string;
}

export class SubmitCheckRunsDto {
  @IsOptional()
  @IsString()
  deviceId?: string; // uuid string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitCheckRunItemDto)
  runs!: SubmitCheckRunItemDto[];
}

/* ----------------------------- Rate limiter ------------------------------ */
const rlWindowMs = 10_000; // 10s
const rlMaxRequests = 20; // 20 per window
const rlState = new Map<string, number[]>();

function checkRate(agentIdStr: string) {
  const now = Date.now();
  const arr = rlState.get(agentIdStr) ?? [];
  const fresh = arr.filter((ts) => now - ts < rlWindowMs);
  fresh.push(now);
  rlState.set(agentIdStr, fresh);
  if (fresh.length > rlMaxRequests) {
    throw new ForbiddenException("Agent is sending check data too fast; back off and retry later.");
  }
}

@Public() // ✅ bypass global AuthCookieGuard; agent endpoints use AgentTokenGuard instead
@Controller("/api/agent")
@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
export class AgentsController {
  constructor(
    private readonly auth: AuthService,
    private readonly agents: AgentsService,
    private readonly checks: ChecksService,
    private readonly tasks: AgentsTasksService
  ) { }

  @Post("/enroll")
  async enroll(
    @Body() body: EnrollAgentDto
  ): Promise<{ agentId: string; agentUuid: string | null; deviceId: string; agentToken: string }> {
    const res = await this.auth.enrollAgent(body as any);

    const agentId = String(res?.agentId ?? "");
    const deviceId = String(res?.deviceId ?? body?.deviceId ?? "");
    const agentToken = String(res?.agentToken ?? "");
    const agentUuid = (res?.agentUuid ?? null) as string | null;

    if (!agentToken || !agentId) {
      throw new Error("Enrollment succeeded but missing token or agentId in response.");
    }

    // Ensure we can return agentUuid even if caller didn't set it
    let finalAgentUuid: string | null = agentUuid;
    if (!finalAgentUuid) {
      finalAgentUuid = await this.agents.getAgentUuidById(agentId);
    }

    return { agentId, agentUuid: finalAgentUuid, deviceId, agentToken };
  }

  @Post("/ping")
  @UseGuards(AgentTokenGuard)
  async ping(@Req() req: any, @Body() body: UpdateAgentFactsDto) {
    const agent = getAgentFromRequest(req); // { id: uuid string, deviceId?, token? }
    await this.agents.updateFacts(String((agent as any).id), body ?? {});
    return { ok: true };
  }

  @Post("/software")
  @UseGuards(AgentTokenGuard)
  async submitSoftware(@Req() req: any, @Body() body: SubmitSoftwareDto) {
    const agent = getAgentFromRequest(req);
    await this.agents.replaceSoftwareInventory(String((agent as any).id), body?.items ?? []);
    return { ok: true, count: body?.items?.length ?? 0 };
  }

  // ===================== Check runs ingestion ======================
  @Post("/check-runs")
  @UseGuards(AgentTokenGuard)
  async submitCheckRuns(@Req() req: any, @Body() body: SubmitCheckRunsDto) {
    const agent = getAgentFromRequest(req);

    checkRate(String((agent as any).id));

    const tokenDeviceRaw = (agent as any)?.deviceId ?? (agent as any)?.device_id;
    const deviceIdFromToken: string | undefined =
      tokenDeviceRaw != null ? String(tokenDeviceRaw) : undefined;

    const deviceIdFromBody: string | undefined = body?.deviceId ? String(body.deviceId) : undefined;

    const deviceId = deviceIdFromBody ?? deviceIdFromToken;

    if (!deviceId) {
      throw new BadRequestException("deviceId is required (bind agent to device first, or include in body).");
    }
    if (deviceIdFromBody && deviceIdFromToken && deviceIdFromBody !== deviceIdFromToken) {
      throw new ForbiddenException("deviceId in body does not match the agent binding.");
    }
    if (!Array.isArray(body?.runs) || body.runs.length === 0) {
      throw new BadRequestException("runs is required and must be a non-empty array");
    }

    const result = await this.checks.ingestAgentRuns({
      agentId: String((agent as any).id),
      deviceId, // uuid string
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

    return { ok: true, inserted: result.inserted, assignmentsCreated: result.assignmentsCreated };
  }

  @Get("/assignments")
  @UseGuards(AgentTokenGuard)
  async getAssignments(@Req() req: any, @Query("deviceId") deviceId?: string) {
    const agent = getAgentFromRequest(req);
    const tokenDeviceRaw = (agent as any)?.deviceId ?? (agent as any)?.device_id;
    const boundDevice: string | undefined = tokenDeviceRaw != null ? String(tokenDeviceRaw) : undefined;

    const effective = deviceId ?? boundDevice;
    if (!effective) {
      throw new BadRequestException("deviceId is required (either query param or bound to agent).");
    }

    const { items } = await this.checks.getAssignmentsForDevice(effective);
    return { items };
  }

  // ===================== Agent task dispatch ======================
  /**
   * Agent polls for queued tasks (patch_scan, patch_install, etc).
   * Returns { ok: true, task: ..., run: ... } or { ok: true, task: null } when nothing is queued.
   */
  @Post("/tasks/next")
  @UseGuards(AgentTokenGuard)
  async claimNextTask(@Req() req: any) {
    const agent = getAgentFromRequest(req);
    const agentId = String((agent as any).id);

    const claimed = await this.tasks.claimNext(agentId);
    return { ok: true, task: claimed?.task ?? null, run: claimed?.run ?? null };
  }

  /**
   * Agent reports a task run completion (stdout/stderr/artifacts/output + status).
   * Body shape is intentionally simple to allow different task types.
   */
  @Post("/tasks/complete")
  @UseGuards(AgentTokenGuard)
  async completeTask(@Req() req: any, @Body() body: any) {
    const agent = getAgentFromRequest(req);
    const agentId = String((agent as any).id);

    const taskId = String(body?.taskId ?? "");
    const runId = String(body?.runId ?? "");
    const status = String(body?.status ?? "");

    if (!taskId || !runId) throw new BadRequestException("taskId and runId are required");
    if (!status) throw new BadRequestException("status is required");

    const allowed: Set<string> = new Set(["succeeded", "failed", "cancelled"]);
    if (!allowed.has(status)) {
      throw new BadRequestException("status must be one of: succeeded | failed | cancelled");
    }

    // ✅ Merge artifacts into output because DB only has agent_task_runs.output (no artifacts column)
    const rawOutput = body?.output && typeof body.output === "object" ? body.output : null;
    const rawArtifacts = body?.artifacts && typeof body.artifacts === "object" ? body.artifacts : null;

    const mergedOutput =
      rawOutput || rawArtifacts
        ? {
          ...(rawOutput ?? {}),
          ...(rawArtifacts ? { artifacts: rawArtifacts } : {}),
        }
        : null;

    await this.tasks.completeRun({
      agentId,
      taskId,
      runId,
      status: status as any,
      stdout: body?.stdout != null ? String(body.stdout) : null,
      stderr: body?.stderr != null ? String(body.stderr) : null,

      // ✅ store everything in output jsonb
      output: mergedOutput,

      // ✅ DO NOT pass artifacts separately (it doesn't exist in schema)
      artifacts: null,
    });

    return { ok: true };
  }

}
