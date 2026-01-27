// backend/src/agents/agents.tasks.service.ts
import { Injectable } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";

type AgentTaskStatus = "pending" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
type AgentTaskType = "script" | "policy" | "update" | "command" | "patch_scan" | "patch_install";

export type ClaimedAgentTask = {
  task: {
    id: string;
    agentId: string;
    type: AgentTaskType;
    payload: Record<string, any>;
    status: AgentTaskStatus;
    queuedAt: string | null;
    startedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  run: {
    id: string;
    taskId: string;
    attempt: number;
    status: AgentTaskStatus;
    startedAt: string;
  };
};

@Injectable()
export class AgentsTasksService {
  constructor(private readonly pg: PgPoolService) { }

  /**
   * Atomically claim the next pending/queued task for an agent, mark task running,
   * and create a corresponding run row.
   *
   * Returns null if there is no work.
   */
  async claimNext(agentId: string): Promise<ClaimedAgentTask | null> {
    const sql = `
WITH next_task AS (
  SELECT t.id
    FROM public.agent_tasks t
   WHERE t.agent_id = $1::uuid
     AND t.status IN ('pending'::agent_task_status, 'queued'::agent_task_status)
   ORDER BY
     COALESCE(t.queued_at, t.created_at) ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED
),
claimed AS (
  UPDATE public.agent_tasks t
     SET status = 'running'::agent_task_status,
         started_at = COALESCE(t.started_at, NOW()),
         queued_at = COALESCE(t.queued_at, NOW()),
         updated_at = NOW()
    WHERE t.id = (SELECT id FROM next_task)
  RETURNING
    t.id,
    t.agent_id,
    t.type,
    t.payload,
    t.status,
    t.queued_at,
    t.started_at,
    t.created_at,
    t.updated_at
),
new_run AS (
  INSERT INTO public.agent_task_runs (
    id,
    task_id,
    attempt,
    status,
    started_at,
    created_at
  )
  SELECT
    gen_random_uuid(),
    c.id,
    COALESCE((SELECT MAX(r.attempt) FROM public.agent_task_runs r WHERE r.task_id = c.id), 0) + 1,
    'running'::agent_task_status,
    NOW(),
    NOW()
  FROM claimed c
  RETURNING
    id,
    task_id,
    attempt,
    status,
    started_at
)
SELECT
  c.id            AS task_id,
  c.agent_id      AS agent_id,
  c.type          AS type,
  c.payload       AS payload,
  c.status        AS task_status,
  c.queued_at     AS queued_at,
  c.started_at    AS task_started_at,
  c.created_at    AS task_created_at,
  c.updated_at    AS task_updated_at,
  r.id            AS run_id,
  r.attempt       AS run_attempt,
  r.status        AS run_status,
  r.started_at    AS run_started_at
FROM claimed c
JOIN new_run r ON r.task_id = c.id
LIMIT 1;
    `.trim();

    const { rows } = await this.pg.query<any>(sql, [agentId]);
    const row = rows[0];
    if (!row) return null;

    return {
      task: {
        id: String(row.task_id),
        agentId: String(row.agent_id),
        type: row.type as AgentTaskType,
        payload: (row.payload ?? {}) as Record<string, any>,
        status: row.task_status as AgentTaskStatus,
        queuedAt: row.queued_at ? new Date(row.queued_at).toISOString() : null,
        startedAt: row.task_started_at ? new Date(row.task_started_at).toISOString() : null,
        createdAt: new Date(row.task_created_at).toISOString(),
        updatedAt: new Date(row.task_updated_at).toISOString(),
      },
      run: {
        id: String(row.run_id),
        taskId: String(row.task_id),
        attempt: Number(row.run_attempt ?? 1),
        status: row.run_status as AgentTaskStatus,
        startedAt: new Date(row.run_started_at).toISOString(),
      },
    };
  }

  /**
   * Mark a run complete, upsert stdout/stderr/artifacts, and finalize the task status.
   * Enforces agent ownership (agent_id must match task.agent_id).
   */
  async completeRun(args: {
    agentId: string;
    taskId: string;
    runId: string;
    status: AgentTaskStatus; // typically succeeded/failed/cancelled
    stdout: string | null;
    stderr: string | null;
    output: Record<string, any> | null; // stored on agent_task_runs.output
    artifacts: Record<string, any> | null; // stored on agent_task_results.artifacts
  }): Promise<void> {
    const status = args.status;

    const sql = `
WITH owned_task AS (
  SELECT t.id
    FROM public.agent_tasks t
   WHERE t.id = $2::uuid
     AND t.agent_id = $1::uuid
   LIMIT 1
),
upd_run AS (
  UPDATE public.agent_task_runs r
     SET status = $4::agent_task_status,
         finished_at = NOW(),
         output = CASE WHEN $5::jsonb IS NULL THEN r.output ELSE $5::jsonb END
    WHERE r.id = $3::uuid
      AND r.task_id = (SELECT id FROM owned_task)
  RETURNING r.id AS run_id, r.task_id AS task_id
),
upsert_results AS (
  INSERT INTO public.agent_task_results (run_id, stdout, stderr, artifacts, created_at)
  SELECT
    u.run_id,
    $6::text,
    $7::text,
    $8::jsonb,
    NOW()
  FROM upd_run u
  ON CONFLICT (run_id) DO UPDATE
    SET stdout = EXCLUDED.stdout,
        stderr = EXCLUDED.stderr,
        artifacts = EXCLUDED.artifacts,
        created_at = NOW()
  RETURNING run_id
),
upd_task AS (
  UPDATE public.agent_tasks t
     SET status = $4::agent_task_status,
         completed_at = CASE
           WHEN $4 IN ('succeeded'::agent_task_status, 'failed'::agent_task_status, 'cancelled'::agent_task_status)
             THEN NOW()
           ELSE t.completed_at
         END,
         updated_at = NOW()
   WHERE t.id = (SELECT task_id FROM upd_run)
  RETURNING t.id
)
SELECT (SELECT id FROM upd_task) AS task_id;
    `.trim();

    const params = [
      args.agentId,
      args.taskId,
      args.runId,
      status,
      args.output ? JSON.stringify(args.output) : null,
      args.stdout,
      args.stderr,
      args.artifacts ? JSON.stringify(args.artifacts) : null,
    ];

    const { rows } = await this.pg.query<{ task_id: string | null }>(sql, params);

    // If the agent tried to complete something it doesn't own (or mismatched ids), we just no-op safely.
    // (Controller/agent can treat as ok=false later if you want stricter behavior.)
    if (!rows[0]?.task_id) return;
  }
}
