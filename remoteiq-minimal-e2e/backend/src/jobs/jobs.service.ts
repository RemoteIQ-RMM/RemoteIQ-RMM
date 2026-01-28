// backend/src/jobs/jobs.service.ts
import {
  Injectable,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
  BadRequestException,
} from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { DispatcherService } from "./dispatcher.service";

export type JobStatus =
  | "queued"
  | "dispatched"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout";

// ──────────────────────────────────────────────────────────────────────────────
// Inputs / payloads
// ──────────────────────────────────────────────────────────────────────────────

export type AgentSelector = {
  /** Back-compat id (stringified). Optional if agentUuid is provided. */
  agentId?: string;
  /** Preferred identifier */
  agentUuid?: string;
};

export type RunScriptInput = AgentSelector & {
  language: "powershell" | "bash";
  scriptText: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutSec?: number;
};

export type FileOpInput = AgentSelector & {
  op: "roots" | "list" | "read" | "write" | "mkdir" | "delete" | "move" | "copy";

  /**
   * For most ops, path is required.
   * For "roots", omit path.
   */
  path?: string;

  // Optional extras depending on op:
  path2?: string; // move/copy destination
  recursive?: boolean; // list/delete/copy
  maxBytes?: number; // read cap
  contentBase64?: string; // write
};

type EnqueueJobInput = AgentSelector & {
  /** Matches your jobs.type column, e.g. RUN_SCRIPT, FILE_OP */
  type: "RUN_SCRIPT" | "FILE_OP" | string;
  /** Will be JSON.stringified into jobs.payload */
  payload: any;
};

function tryParseJson(s: any): any | null {
  if (typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeSelector(sel: AgentSelector): AgentSelector {
  return {
    agentId: sel.agentId ? String(sel.agentId).trim() : undefined,
    agentUuid: sel.agentUuid ? String(sel.agentUuid).trim() : undefined,
  };
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger("JobsService");

  constructor(
    private readonly pg: PgPoolService,
    @Inject(forwardRef(() => DispatcherService))
    private readonly dispatcher: DispatcherService
  ) { }

  /**
   * Get a pg Pool-like object that supports connect().
   * PgPoolService in your repo has differed over time, so this is defensive.
   */
  private getPoolLike(): any {
    const anyPg = this.pg as any;

    if (typeof anyPg.ensurePool === "function") {
      return anyPg.ensurePool();
    }
    if (anyPg.pool && typeof anyPg.pool.connect === "function") {
      return anyPg.pool;
    }
    if (typeof anyPg.connect === "function") {
      // If PgPoolService itself is a Pool
      return anyPg;
    }

    throw new Error("PgPoolService does not expose a connect()-capable pool");
  }

  /** Resolve an agent id from either uuid or id (string) */
  private async resolveAgentId(sel: AgentSelector): Promise<string> {
    const s = normalizeSelector(sel);

    if (s.agentUuid) {
      const { rows } = await this.pg.query<{ id: string }>(
        `SELECT id::text AS id
           FROM public.agents
          WHERE agent_uuid = $1
          LIMIT 1`,
        [s.agentUuid]
      );

      const id = rows[0]?.id;
      if (!id) throw new NotFoundException("Agent not found for provided agentUuid");
      return id;
    }

    if (s.agentId) return s.agentId;

    throw new BadRequestException("Either agentUuid or agentId is required");
  }

  private async assertAgentExists(agentId: string): Promise<void> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text AS id FROM public.agents WHERE id::text = $1 LIMIT 1`,
      [agentId]
    );
    if (!rows[0]?.id) throw new NotFoundException("Agent not found");
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Generic enqueue
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * Insert into jobs + attempt immediate dispatch.
   */
  async enqueueJob(input: EnqueueJobInput) {
    const agentId = await this.resolveAgentId(input);
    await this.assertAgentExists(agentId);

    const payloadJson = JSON.stringify(input.payload ?? {});

    const { rows } = await this.pg.query<{
      id: string;
      agent_id: string;
      type: string;
      status: string;
      created_at: string;
    }>(
      `INSERT INTO jobs (agent_id, type, payload, status, created_at)
       VALUES ($1, $2, $3, 'queued', now())
       RETURNING id, agent_id, type, status, created_at`,
      [agentId, input.type, payloadJson]
    );

    const job = rows[0];

    // Best-effort dispatch (do not block request)
    this.dispatcher.tryDispatch(job.id).catch((e: any) => {
      this.logger.warn(`Dispatch failed for job ${job.id}: ${e?.message ?? e}`);
    });

    return job;
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Specific helpers
  // ──────────────────────────────────────────────────────────────────────────────

  async createRunScriptJob(input: RunScriptInput) {
    if (!input?.language) throw new BadRequestException("language is required");
    if (!input?.scriptText?.trim()) throw new BadRequestException("scriptText is required");

    const payload = {
      language: input.language,
      scriptText: input.scriptText,
      args: input.args ?? [],
      env: input.env ?? {},
      timeoutSec: input.timeoutSec ?? 120,
    };

    return this.enqueueJob({
      agentId: input.agentId,
      agentUuid: input.agentUuid,
      type: "RUN_SCRIPT",
      payload,
    });
  }

  async createFileOpJob(input: FileOpInput) {
    if (!input?.op) throw new BadRequestException("op is required");

    const op = input.op;

    // roots = no path
    if (op !== "roots") {
      if (!input?.path?.trim()) throw new BadRequestException("path is required");
    }

    if ((op === "move" || op === "copy") && !String(input.path2 ?? "").trim()) {
      throw new BadRequestException("path2 is required for move/copy");
    }

    if (op === "write" && !String(input.contentBase64 ?? "").trim()) {
      throw new BadRequestException("contentBase64 is required for write");
    }

    const payload: any = {
      op,
      recursive: !!input.recursive,
      maxBytes: Number.isFinite(input.maxBytes) ? input.maxBytes : undefined,
      contentBase64: input.contentBase64 ?? undefined,
      path2: input.path2 ?? undefined,
    };

    // Only include path if present (roots should omit it)
    if (op !== "roots") {
      payload.path = String(input.path ?? "");
    }

    return this.enqueueJob({
      agentId: input.agentId,
      agentUuid: input.agentUuid,
      type: "FILE_OP",
      payload,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Reads / status updates
  // ──────────────────────────────────────────────────────────────────────────────

  /** Read a job and its (optional) result + parsed stdout/payload if it is JSON */
  async getJobWithResult(jobId: string) {
    const { rows } = await this.pg.query<any>(
      `SELECT
          j.id,
          j.agent_id,
          j.type,
          j.status,
          j.payload,
          j.created_at,
          j.dispatched_at,
          j.started_at,
          j.finished_at,
          r.exit_code,
          r.stdout,
          r.stderr,
          r.duration_ms
        FROM jobs j
        LEFT JOIN job_results r ON r.job_id = j.id
       WHERE j.id = $1
       LIMIT 1`,
      [jobId]
    );

    const job = rows[0];
    if (!job) throw new NotFoundException("Job not found");

    const parsedStdout = tryParseJson(job.stdout);
    const parsedPayload =
      typeof job.payload === "string" ? tryParseJson(job.payload) : job.payload ?? null;

    return { ...job, parsed_stdout: parsedStdout, parsed_payload: parsedPayload };
  }

  async markDispatched(jobId: string) {
    await this.pg.query(
      `UPDATE jobs SET status = 'dispatched', dispatched_at = now()
        WHERE id = $1 AND status = 'queued'`,
      [jobId]
    );
  }

  async markRunning(jobId: string) {
    await this.pg.query(
      `UPDATE jobs SET status = 'running', started_at = now()
        WHERE id = $1 AND status IN ('queued','dispatched')`,
      [jobId]
    );
  }

  async finishJob(
    jobId: string,
    result: { exitCode: number; stdout: string; stderr: string; durationMs: number },
    status: "succeeded" | "failed" | "timeout"
  ) {
    const pool = this.getPoolLike();
    const conn = await pool.connect();

    try {
      await conn.query("BEGIN");

      await conn.query(
        `UPDATE jobs
            SET status = $1,
                finished_at = now()
          WHERE id = $2`,
        [status, jobId]
      );

      await conn.query(
        `INSERT INTO job_results (job_id, exit_code, stdout, stderr, duration_ms)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (job_id)
         DO UPDATE SET
           exit_code = EXCLUDED.exit_code,
           stdout = EXCLUDED.stdout,
           stderr = EXCLUDED.stderr,
           duration_ms = EXCLUDED.duration_ms`,
        [
          jobId,
          result.exitCode,
          result.stdout ?? "",
          result.stderr ?? "",
          result.durationMs ?? 0,
        ]
      );

      await conn.query("COMMIT");
    } catch (e) {
      try {
        await conn.query("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw e;
    } finally {
      conn.release();
    }
  }
}
