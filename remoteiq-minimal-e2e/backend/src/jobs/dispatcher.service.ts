// backend/src/jobs/dispatcher.service.ts
import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { SocketRegistry } from "../common/socket-registry.service";
import { JobsService } from "./jobs.service";

type RunScriptPayload = {
  language: "powershell" | "bash";
  scriptText: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutSec?: number;
};

type FileOpPayload = {
  op: "roots" | "list" | "read" | "write" | "mkdir" | "delete" | "move" | "copy";
  path?: string;
  path2?: string;
  contentBase64?: string;
  encoding?: "utf8" | "base64";
  recursive?: boolean;
  maxBytes?: number;
};

type JobRow = {
  id: string;
  agent_id: string; // agents.id
  agent_uuid: string | null; // agents.agent_uuid
  type: string;
  payload: unknown;
  status: string;
};

// safe parse for jsonb | text JSON
function parsePayload(raw: unknown): any | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function isRunScriptPayload(v: any): v is RunScriptPayload {
  return !!v && (v.language === "powershell" || v.language === "bash") && typeof v.scriptText === "string";
}

function isFileOpPayload(v: any): v is FileOpPayload {
  const op = v?.op;

  const okOp =
    op === "roots" ||
    op === "list" ||
    op === "read" ||
    op === "write" ||
    op === "mkdir" ||
    op === "delete" ||
    op === "move" ||
    op === "copy";

  if (!v || !okOp) return false;

  // roots intentionally has no path requirement
  if (op === "roots") return true;

  // all other ops require a non-empty path
  return typeof v.path === "string" && v.path.trim().length > 0;
}

function uniqKeys(keys: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const s = String(k ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function isSocketOpen(s: any): boolean {
  // ws: OPEN=1, browser ws: readyState===1 too
  return !!s && typeof s.readyState === "number" && s.readyState === 1;
}

@Injectable()
export class DispatcherService {
  private readonly logger = new Logger("Dispatcher");

  constructor(
    private readonly pg: PgPoolService,
    private readonly sockets: SocketRegistry,
    @Inject(forwardRef(() => JobsService)) private readonly jobs: JobsService
  ) { }

  /** Try to dispatch a specific queued job to its agent over WS */
  async tryDispatch(jobId: string) {
    const { rows } = await this.pg.query<JobRow>(
      `
      SELECT
        j.id::text AS id,
        j.agent_id::text AS agent_id,
        a.agent_uuid::text AS agent_uuid,
        j.type,
        j.payload,
        j.status
      FROM jobs j
      LEFT JOIN public.agents a ON a.id = j.agent_id
      WHERE j.id = $1
      LIMIT 1
      `,
      [jobId]
    );

    const job = rows[0];
    if (!job) return;

    // Only dispatch queued jobs (avoid double-send)
    if (String(job.status).toLowerCase() !== "queued") return;

    // Try socket lookup by BOTH ids (DB id and agent_uuid)
    // NOTE: keep both. In your codebase, different agents have registered under different keys.
    const keysToTry = uniqKeys([job.agent_id, job.agent_uuid]);

    let socket: any = null;
    let matchedKey: string | null = null;

    for (const k of keysToTry) {
      const s = this.sockets.getByAgent(k);
      if (isSocketOpen(s)) {
        socket = s;
        matchedKey = k;
        break;
      }
    }

    if (!socket) {
      this.logger.debug(
        `Agent not connected; tried keys [${keysToTry.join(", ")}]; job ${job.id} stays queued`
      );
      return;
    }

    const type = String(job.type || "").toUpperCase();
    const parsed = parsePayload(job.payload);

    try {
      if (type === "RUN_SCRIPT") {
        if (!isRunScriptPayload(parsed)) {
          this.logger.warn(`Invalid RUN_SCRIPT payload for job ${job.id}; marking failed`);
          await this.jobs.finishJob(
            job.id,
            {
              exitCode: -1,
              stdout: "",
              stderr: "Invalid RUN_SCRIPT payload JSON",
              durationMs: 0,
            },
            "failed"
          );
          return;
        }

        // Send first. Only markDispatched after send succeeds.
        socket.send(
          JSON.stringify({
            t: "job_run_script",
            jobId: job.id,
            language: parsed.language,
            scriptText: parsed.scriptText,
            args: parsed.args ?? [],
            env: parsed.env ?? {},
            timeoutSec: parsed.timeoutSec ?? 120,
          })
        );

        await this.jobs.markDispatched(job.id);
        this.logger.debug(`Dispatched RUN_SCRIPT ${job.id} via key=${matchedKey}`);
        return;
      }

      if (type === "FILE_OP") {
        if (!isFileOpPayload(parsed)) {
          this.logger.warn(`Invalid FILE_OP payload for job ${job.id}; marking failed`);
          await this.jobs.finishJob(
            job.id,
            {
              exitCode: -1,
              stdout: "",
              stderr: "Invalid FILE_OP payload JSON",
              durationMs: 0,
            },
            "failed"
          );
          return;
        }

        socket.send(
          JSON.stringify({
            t: "job_file_op",
            jobId: job.id,
            ...parsed,
          })
        );

        await this.jobs.markDispatched(job.id);
        this.logger.debug(`Dispatched FILE_OP ${job.id} via key=${matchedKey}`);
        return;
      }

      this.logger.warn(`Unknown job type "${type}" for job ${job.id}; failing`);
      await this.jobs.finishJob(
        job.id,
        {
          exitCode: -1,
          stdout: "",
          stderr: `Unknown job type: ${type}`,
          durationMs: 0,
        },
        "failed"
      );
    } catch (e: any) {
      // If send fails, keep queued so it can retry later
      this.logger.warn(`WS send failed for job ${job.id} (key=${matchedKey}): ${e?.message ?? e}`);
    }
  }

  /**
   * Opportunistically dispatch all queued jobs for an agent (called on connect).
   * Accept either agents.id OR agents.agent_uuid.
   */
  async dispatchQueuedForAgent(agentIdOrUuid: string | number) {
    const key = String(agentIdOrUuid ?? "").trim();
    if (!key) return;

    // Resolve agent to DB id, because jobs.agent_id stores agents.id
    const { rows: agentRows } = await this.pg.query<{ id: string }>(
      `
      SELECT id::text AS id
      FROM public.agents
      WHERE id::text = $1 OR agent_uuid::text = $1
      LIMIT 1
      `,
      [key]
    );

    const agentId = agentRows[0]?.id;
    if (!agentId) {
      this.logger.debug(`dispatchQueuedForAgent: no agent found for key=${key}`);
      return;
    }

    const { rows } = await this.pg.query<{ id: string }>(
      `
      SELECT id::text AS id
      FROM jobs
      WHERE agent_id::text = $1 AND status = 'queued'
      ORDER BY created_at ASC
      `,
      [agentId]
    );

    for (const j of rows) {
      await this.tryDispatch(j.id);
    }
  }
}
