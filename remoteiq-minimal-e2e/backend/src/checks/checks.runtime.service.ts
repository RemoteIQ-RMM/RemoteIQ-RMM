// remoteiq-minimal-e2e/backend/src/checks/checks.runtime.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { UiSocketRegistry } from "../common/ui-socket-registry.service";

/**
 * Lightweight runtime service for device-scoped checks:
 * - ensures minimal schema (idempotent)
 * - upserts per-device check assignments
 * - ingests check run rows
 * - lists checks by device for the UI
 * - broadcasts debounced UI updates over WS
 *
 * Notes:
 * - device_id is TEXT to accommodate non-UUID agent ids
 * - unique per-device dedupe key uses (dedupe_key) OR (type|name) fallback
 */

export type NormalizedRunStatus = "OK" | "WARN" | "CRIT" | "TIMEOUT" | "UNKNOWN";

export type IngestRun = {
    assignmentId?: string;
    dedupeKey?: string | null;
    checkType?: string | null;
    checkName?: string | null;
    status: string;
    severity?: "WARN" | "CRIT";
    metrics?: Record<string, any>;
    output?: string;
    startedAt?: string;
    finishedAt?: string;
};

export type IngestPayload = {
    agentId: string;
    deviceId: string; // TEXT
    runs: IngestRun[];
};

export type DeviceCheckDTO = {
    id: string; // assignment id
    name: string;
    status: "Passing" | "Warning" | "Failing";
    lastRun: string | null;
    output: string;
    // optional future fields
    type?: string | null;
    severity?: "WARN" | "CRIT" | null;
    metrics?: Record<string, any> | null;
    thresholds?: Record<string, any> | null;
    maintenance?: boolean | null;
    dedupeKey?: string | null;
    category?: string | null;
    tags?: string[] | null;
};

function normalizeStatus(s?: string | null): NormalizedRunStatus {
    const t = String(s ?? "").trim().toUpperCase();
    if (t === "OK" || t === "PASS" || t === "PASSING") return "OK";
    if (t === "WARN" || t === "WARNING") return "WARN";
    if (t === "CRIT" || t === "ERROR" || t === "FAIL" || t === "FAILING") return "CRIT";
    if (t === "TIMEOUT") return "TIMEOUT";
    return "UNKNOWN";
}
function toUiStatus(s?: string | null): DeviceCheckDTO["status"] {
    switch (normalizeStatus(s)) {
        case "OK":
            return "Passing";
        case "WARN":
            return "Warning";
        default:
            return "Failing";
    }
}

@Injectable()
export class ChecksRuntimeService {
    private readonly log = new Logger(ChecksRuntimeService.name);
    private readonly deviceDebounce = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        private readonly pg: PgPoolService,
        private readonly uiSockets: UiSocketRegistry,
    ) { }

    /* ------------------------------------------------------------------------ */
    /* Schema (idempotent)                                                      */
    /* ------------------------------------------------------------------------ */

    private async ensureSchema(): Promise<void> {
        await this.pg.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS public.check_assignments (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id   text NOT NULL,
        dedupe_key  text,
        check_type  text,
        check_name  text,
        created_at  timestamptz DEFAULT now(),
        updated_at  timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.check_runs (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id uuid,
        device_id     text NOT NULL,
        status        text NOT NULL,
        severity      text,
        metrics       jsonb,
        output        text,
        started_at    timestamptz,
        finished_at   timestamptz,
        created_at    timestamptz DEFAULT now()
      );

      -- per-device uniqueness
      CREATE UNIQUE INDEX IF NOT EXISTS check_assignments_uk
        ON public.check_assignments (
          device_id,
          COALESCE(
            NULLIF(dedupe_key, ''),
            LOWER(COALESCE(check_type,'')) || '|' || LOWER(COALESCE(check_name,''))
          )
        );

      CREATE INDEX IF NOT EXISTS check_assignments_device_id_idx ON public.check_assignments (device_id);
      CREATE INDEX IF NOT EXISTS check_runs_assignment_id_idx    ON public.check_runs (assignment_id);
      CREATE INDEX IF NOT EXISTS check_runs_device_id_idx        ON public.check_runs (device_id);
      CREATE INDEX IF NOT EXISTS check_runs_created_at_idx       ON public.check_runs (created_at);
    `);
    }

    /* ------------------------------------------------------------------------ */
    /* Public: UI listing                                                       */
    /* ------------------------------------------------------------------------ */

    async listByDevice(deviceId: string, limit = 100): Promise<{ items: DeviceCheckDTO[] }> {
        if (!Number.isFinite(limit) || limit < 1) limit = 1;
        if (limit > 200) limit = 200;

        await this.ensureSchema();

        const sql = `
      WITH latest_run AS (
        SELECT
          cr.assignment_id,
          cr.status,
          cr.severity,
          cr.metrics,
          cr.output,
          cr.finished_at AS last_run,
          ROW_NUMBER() OVER (PARTITION BY cr.assignment_id ORDER BY cr.finished_at DESC NULLS LAST) AS rn
        FROM public.check_runs cr
        WHERE cr.device_id = $1
      )
      SELECT
        a.id                      AS assignment_id,
        a.dedupe_key              AS dedupe_key,
        a.check_type              AS check_type,
        COALESCE(NULLIF(a.check_name,''), NULLIF(a.check_type,''), 'Check') AS check_name,
        lr.status                 AS run_status,
        lr.severity               AS run_severity,
        lr.metrics                AS run_metrics,
        lr.output                 AS run_output,
        lr.last_run               AS last_run
      FROM public.check_assignments a
      LEFT JOIN latest_run lr ON lr.assignment_id = a.id AND lr.rn = 1
      WHERE a.device_id = $1
      ORDER BY lr.last_run DESC NULLS LAST, check_name ASC
      LIMIT $2;
    `;

        try {
            const { rows } = await this.pg.query(sql, [deviceId, limit]);
            const items: DeviceCheckDTO[] = (rows || []).map((r: any) => ({
                id: r.assignment_id,
                name: r.check_name ?? "Check",
                status: toUiStatus(r.run_status),
                lastRun: r.last_run ? new Date(r.last_run as any).toISOString() : null,
                output: (r.run_output ?? "").length > 8192 ? String(r.run_output ?? "").slice(0, 8192) + "…" : (r.run_output ?? ""),
                type: r.check_type ?? null,
                severity: r.run_severity ?? null,
                metrics: r.run_metrics ?? null,
                dedupeKey: r.dedupe_key ?? null,
                thresholds: null,
                maintenance: null,
                category: null,
                tags: null,
            }));
            return { items };
        } catch (err: any) {
            const code = String(err?.code || err?.original?.code || "");
            const msg = String(err?.message || "").toLowerCase();
            if (code === "42P01" || code === "42703" || (msg.includes("relation") && msg.includes("does not exist"))) {
                this.log.warn("listByDevice: schema missing; returning empty set");
                return { items: [] };
            }
            this.log.error("listByDevice failed", err?.stack || err);
            return { items: [] };
        }
    }

    /* ------------------------------------------------------------------------ */
    /* Public: Agent ingestion                                                  */
    /* ------------------------------------------------------------------------ */

    async ingestAgentRuns(input: IngestPayload): Promise<{ inserted: number; assignmentsCreated: number }> {
        if (!input?.runs?.length) return { inserted: 0, assignmentsCreated: 0 };

        await this.ensureSchema();

        const MAX_OUTPUT = 64 * 1024;

        // ---- 1) build source rows with ordinal
        const srcValues: string[] = [];
        const srcParams: any[] = [];
        let p = 1;

        for (let i = 0; i < input.runs.length; i++) {
            const r = input.runs[i];

            const type = (r.checkType ?? "").toString().trim().toUpperCase() || null;
            // IMPORTANT: do not mix ?? and || without parentheses — TS5076 fix
            const name = ((r.checkName ?? type) ?? "Agent Check").toString().trim().slice(0, 200);

            const dk = (r.dedupeKey ?? null) as string | null;

            // (ord, device_id, dedupe_key, check_type, check_name)
            srcValues.push(`($${p++}::int, $${p++}::text, $${p++}::text, $${p++}::text, $${p++}::text)`);
            srcParams.push(i + 1, input.deviceId, dk, type, name);
        }

        // ---- 2) insert missing assignments
        const insertSql = `
      WITH src(ord, device_id, dedupe_key, check_type, check_name) AS (
        VALUES ${srcValues.join(",")}
      )
      INSERT INTO public.check_assignments (device_id, dedupe_key, check_type, check_name)
      SELECT s.device_id, s.dedupe_key, s.check_type, s.check_name
      FROM src s
      ON CONFLICT (
        device_id,
        COALESCE(
          NULLIF(dedupe_key,''),
          LOWER(COALESCE(check_type,'')) || '|' || LOWER(COALESCE(check_name,''))
        )
      )
      DO NOTHING
      RETURNING id;
    `;
        const insertRes = await this.pg.query<{ id: string }>(insertSql, srcParams);
        const assignmentsCreated = (insertRes.rows || []).length;

        // ---- 3) map back to assignment ids by original order
        const mapSql = `
      WITH src(ord, device_id, dedupe_key, check_type, check_name) AS (
        VALUES ${srcValues.join(",")}
      )
      SELECT
        s.ord,
        ca.id::text AS assignment_id
      FROM src s
      JOIN public.check_assignments ca
        ON ca.device_id = s.device_id
       AND COALESCE(NULLIF(ca.dedupe_key,''),
            LOWER(COALESCE(ca.check_type,'')) || '|' || LOWER(COALESCE(ca.check_name,'')))
        = COALESCE(NULLIF(s.dedupe_key,''),
            LOWER(COALESCE(s.check_type,'')) || '|' || LOWER(COALESCE(s.check_name,'')))
      ORDER BY s.ord ASC;
    `;
        const mapRes = await this.pg.query<{ ord: number; assignment_id: string }>(mapSql, srcParams);
        const assignmentByOrd = new Map<number, string>();
        for (const r of mapRes.rows) assignmentByOrd.set(r.ord, r.assignment_id);

        // ---- 4) build run rows
        const runValues: string[] = [];
        const runParams: any[] = [];
        p = 1;

        for (let i = 0; i < input.runs.length; i++) {
            const r = input.runs[i];

            const mapped = assignmentByOrd.get(i + 1);
            const validUuid = r.assignmentId && /^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12}$/.test(r.assignmentId);
            const assignmentId = validUuid ? r.assignmentId! : mapped;
            if (!assignmentId) continue;

            const status = normalizeStatus(r.status);
            const severity = r.severity === "CRIT" ? "CRIT" : (r.severity === "WARN" ? "WARN" : null);
            const output = (r.output ?? "").toString().slice(0, MAX_OUTPUT);
            const startedAt = r.startedAt ? new Date(r.startedAt) : new Date();
            const finishedAt = r.finishedAt ? new Date(r.finishedAt) : new Date();

            runValues.push(`(
        $${p++}::uuid,        -- assignment_id
        $${p++}::text,        -- device_id
        $${p++}::text,        -- status
        $${p++}::text,        -- severity
        $${p++}::jsonb,       -- metrics
        $${p++}::text,        -- output
        $${p++}::timestamptz, -- started_at
        $${p++}::timestamptz  -- finished_at
      )`);

            runParams.push(
                assignmentId,
                input.deviceId,
                status,
                severity,
                r.metrics ? JSON.stringify(r.metrics) : null,
                output,
                startedAt.toISOString(),
                finishedAt.toISOString(),
            );
        }

        let inserted = 0;
        if (runValues.length) {
            const insSql = `
        INSERT INTO public.check_runs
          (assignment_id, device_id, status, severity, metrics, output, started_at, finished_at)
        VALUES ${runValues.join(",")}
        RETURNING id;
      `;
            const ins = await this.pg.query<{ id: string }>(insSql, runParams);
            inserted = (ins.rows || []).length;
        }

        if (inserted > 0) this.scheduleDeviceBroadcast(input.deviceId, inserted);

        this.log.log(`ingested ${inserted} run(s) for device ${input.deviceId}; new assignments: ${assignmentsCreated}`);
        return { inserted, assignmentsCreated };
    }

    /* ------------------------------------------------------------------------ */
    /* Optional: server-driven assignments (thin, derived from assignments)      */
    /* ------------------------------------------------------------------------ */

    async getAssignmentsForDevice(deviceId: string): Promise<{
        items: Array<{
            assignmentId: string;
            type: string | null;
            name: string | null;
            intervalSec: number;
            timeoutSec: number;
            enabled: boolean;
            dedupeKey?: string | null;
            config?: any;
            thresholds?: any;
        }>;
    }> {
        await this.ensureSchema();

        const { rows } = await this.pg.query(
            `
      SELECT
        a.id::text   AS assignment_id,
        a.check_type AS check_type,
        a.check_name AS check_name,
        a.dedupe_key AS dedupe_key
      FROM public.check_assignments a
      WHERE a.device_id = $1
      ORDER BY a.created_at DESC;
      `,
            [deviceId],
        );

        return {
            items: rows.map((r: any) => ({
                assignmentId: r.assignment_id,
                type: r.check_type ?? null,
                name: r.check_name ?? null,
                intervalSec: 60,
                timeoutSec: 10,
                enabled: true,
                dedupeKey: r.dedupe_key ?? null,
                config: null,
                thresholds: null,
            })),
        };
    }

    /* ------------------------------------------------------------------------ */
    /* WS broadcast (debounced per device)                                      */
    /* ------------------------------------------------------------------------ */

    private scheduleDeviceBroadcast(deviceId: string, changed: number) {
        const key = String(deviceId);
        const existing = this.deviceDebounce.get(key);
        if (existing) clearTimeout(existing as any);

        const handle = setTimeout(() => {
            try {
                const payload = {
                    t: "device_checks_updated",
                    deviceId: key,
                    changed,
                    at: new Date().toISOString(),
                };
                const sent = this.uiSockets.broadcastToDevice(key, payload);
                this.log.debug(`Broadcast device_checks_updated → ${sent} UI socket(s) for device ${key}`);
            } catch (e: any) {
                this.log.warn(`Broadcast failed for device ${key}: ${e?.message ?? e}`);
            } finally {
                this.deviceDebounce.delete(key);
            }
        }, 750);

        this.deviceDebounce.set(key, handle);
    }
}
