import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Headers,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { PgPoolService } from "../storage/pg-pool.service";
import { Public } from "../auth/public.decorator";

@Public() // ✅ secured by x-admin-api-key; avoid AuthCookieGuard blocking automation/break-glass usage
@Controller("/api/admin")
export class JobsController {
  private readonly logger = new Logger("JobsController");

  constructor(
    private readonly jobs: JobsService,
    private readonly pg: PgPoolService,
  ) { }

  private checkAdmin(key: string | undefined) {
    if (!key || key !== process.env.ADMIN_API_KEY) {
      throw new UnauthorizedException("invalid admin key");
    }
  }

  @Post("/agents")
  async listAgents(@Headers("x-admin-api-key") key: string | undefined) {
    this.checkAdmin(key);
    try {
      const { rows } = await this.pg.query(
        `SELECT 
            id, 
            agent_uuid::text AS agent_uuid, 
            device_id, 
            hostname, 
            os, 
            arch, 
            version, 
            created_at, 
            updated_at
         FROM public.agents
         ORDER BY created_at DESC`,
      );
      return { items: rows };
    } catch (e: any) {
      this.logger.error(`listAgents failed: ${e?.message ?? e}`, e?.stack ?? undefined);
      throw e;
    }
  }

  @Post("/jobs/run-script")
  async runScript(
    @Headers("x-admin-api-key") key: string | undefined,
    @Body()
    body: {
      agentId?: string; // numeric id as string (back-compat)
      agentUuid?: string; // new: prefer uuid
      language: "powershell" | "bash";
      scriptText: string;
      args?: string[];
      env?: Record<string, string>;
      timeoutSec?: number;
    },
  ) {
    this.checkAdmin(key);
    try {
      const job = await this.jobs.createRunScriptJob(body);
      return job;
    } catch (e: any) {
      this.logger.error(`run-script failed: ${e?.message ?? e}`, e?.stack ?? undefined);
      throw e;
    }
  }

  @Get("/jobs/:id")
  async getJob(@Headers("x-admin-api-key") key: string | undefined, @Param("id") id: string) {
    this.checkAdmin(key);
    return this.jobs.getJobWithResult(id);
  }
}
