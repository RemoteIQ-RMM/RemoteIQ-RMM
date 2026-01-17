// src/agents/agents.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { EnrollAgentDto } from "./dto/enroll-agent.dto";
import { AgentsService } from "./agents.service";
import { AgentTokenGuard, getAgentFromRequest } from "../common/agent-token.util";
import { UpdateAgentFactsDto } from "./dto/update-agent-facts.dto";
import { SubmitSoftwareDto } from "./dto/submit-software.dto";
import { ChecksService } from "../checks/checks.service";
import {
  IsArray,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
} from "class-validator";
import { Type } from "class-transformer";
import { Public } from "../auth/public.decorator";

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
  @IsString() // <— accepts "win-..." style ids
  deviceId?: string;

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
    private readonly checks: ChecksService
  ) { }

  @Post("/enroll")
  async enroll(
    @Body() body: EnrollAgentDto
  ): Promise<{ agentId: string; agentUuid: string | null; deviceId: string; agentToken: string }> {
    const res: any = await this.auth.enrollAgent(body);

    const agentId = String(res?.agentId ?? res?.agent?.id ?? "");
    const deviceId = String(res?.deviceId ?? res?.device?.id ?? body?.deviceId ?? "");
    const agentToken = String(res?.agentToken ?? res?.token ?? res?.accessToken ?? "");

    if (!agentToken || !agentId) {
      throw new Error("Enrollment succeeded but missing token or agentId in response.");
    }

    let agentUuid: string | null = null;
    try {
      agentUuid = await this.agents.getAgentUuidById(Number(agentId));
    } catch {
      agentUuid = null;
    }

    return { agentId, agentUuid, deviceId, agentToken };
  }

  @Post("/ping")
  @UseGuards(AgentTokenGuard)
  async ping(@Req() req: any, @Body() body: UpdateAgentFactsDto) {
    const agent = getAgentFromRequest(req);
    await this.agents.updateFacts(Number((agent as any).id), body ?? {});
    return { ok: true };
  }

  @Post("/software")
  @UseGuards(AgentTokenGuard)
  async submitSoftware(@Req() req: any, @Body() body: SubmitSoftwareDto) {
    const agent = getAgentFromRequest(req);
    await this.agents.upsertSoftware(Number((agent as any).id), body?.items ?? []);
    return { ok: true, count: body?.items?.length ?? 0 };
  }

  // ===================== Check runs ingestion ======================
  @Post("/check-runs")
  @UseGuards(AgentTokenGuard)
  async submitCheckRuns(@Req() req: any, @Body() body: SubmitCheckRunsDto) {
    const agent = getAgentFromRequest(req);

    checkRate(String((agent as any).id));

    const tokenDeviceRaw = (agent as any)?.deviceId ?? (agent as any)?.device_id;
    const deviceIdFromToken: string | undefined = tokenDeviceRaw != null ? String(tokenDeviceRaw) : undefined;

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
      deviceId, // TEXT id
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
}
