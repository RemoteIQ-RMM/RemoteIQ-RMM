import { Injectable, Logger } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { UiSocketRegistry } from "../common/ui-socket-registry.service";

/**
 * Device-scoped checks runtime:
 * - Ensures minimal schema that matches the existing normalized model:
 *   checks (definitions) + check_assignments (target-based) + check_runs (results)
 * - Upserts per-device assignments using (target_type,target_id,dedupe_key)
 * - Ingests runs
 * - Lists checks for a device detail page
 *
 * IMPORTANT:
 * - check_assignments is target-based: (target_type, target_id)
 * - Do NOT assume check_assignments.device_id exists (it does not in your schema)
 */

export type NormalizedRunStatus = "OK" | "WARN" | "CRIT" | "TIMEOUT" | "UNKNOWN";

export type IngestRun = {
    assignmentId?: string;
    dedupeKey?: string | null;
    checkType?: string | null;
    checkName?: string | null;
    status: string;
    severity?: string | null; // can be enum/text depending on schema
    metrics?: Record<string, any>;
    output?: string;
    startedAt?: string;
    finishedAt?: string;
};

export type IngestPayload = {
    agentId: string;   // agents.id (uuid string)
    deviceId: string;  // may be agents.id or devices.id or any text identifier you already use
    runs: IngestRun[];
};

export type DeviceCheckDTO = {
    id: string; // assignment id
    name: string;
    status: "Passing" | "Warning" | "Failing";
    lastRun: string | null;
    output: string;

    type?: string | null;
    severity?: string | null;
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
    if (t === "CRIT" || t === "CRITICAL" || t === "ERROR" || t === "FAIL" || t === "FAILED" || t === "FAILING") return "CRIT";
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

function isUuid(v: string): boolean {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);
}

function normalizeDedupeKey(raw: string | null | undefined, checkType: string | null, checkName: string | null): string {
    const dk = String(raw ?? "").trim();
    if (dk) return dk;
    const t = String(checkType ?? "").trim().toLowerCase();
    const n = String(checkName ?? "").trim().toLowerCase();
    const fallback = `${t}|${n}`.trim();
    return fallback ? fallback : "check|check";
}

@Injectable()
export class ChecksRuntimeService {
    private readonly log = new Logger(ChecksRuntimeService.name);
    private readonly deviceDebounce = new Map<string, ReturnType<typeof setTimeout>>();

    private schemaReady = false;
    private schemaEnsuring: Promise<void> | null = null;

    constructor(
        private readonly pg: PgPoolService,
        private readonly uiSockets: UiSocketRegistry,
    ) { }

    /* ------------------------------------------------------------------------ */
    /* Schema (idempotent, matches existing model)                               */
    /* ------------------------------------------------------------------------ */

    private async ensureSchema(): Promise<void> {
        if (this.schemaReady) return;
        if (this.schemaEnsuring) return await this.schemaEnsuring;

        this.schemaEnsuring = (async () => {
            await this.pg.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

            // Create tables if missing (use portable types; existing enums are fine)
            await this.pg.query(`
        CREATE TABLE IF NOT EXISTS public.check_assignments (
          id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          check_id    uuid,
          target_type text NOT NULL,
          target_id   uuid NOT NULL,
          created_by  uuid,
          created_at  timestamptz DEFAULT now(),
          updated_at  timestamptz DEFAULT now(),
          dedupe_key  text,
          check_type  text,
          check_name  text
        );
      `);

            await this.pg.query(`
        CREATE TABLE IF NOT EXISTS public.check_runs (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          assignment_id uuid,
          device_id     text,
          status        text,
          severity      text,
          started_at    timestamptz,
          finished_at   timestamptz,
          metrics       jsonb,
          output        text,
          created_at    timestamptz DEFAULT now()
        );
      `);

            // Patch columns if older tables exist (idempotent)
            await this.pg.query(`
        ALTER TABLE public.check_assignments
          ADD COLUMN IF NOT EXISTS check_id    uuid,
          ADD COLUMN IF NOT EXISTS target_type text,
          ADD COLUMN IF NOT EXISTS target_id   uuid,
          ADD COLUMN IF NOT EXISTS created_by  uuid,
          ADD COLUMN IF NOT EXISTS created_at  timestamptz DEFAULT now(),
          ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now(),
          ADD COLUMN IF NOT EXISTS dedupe_key  text,
          ADD COLUMN IF NOT EXISTS check_type  text,
          ADD COLUMN IF NOT EXISTS check_name  text;
      `);

            await this.pg.query(`
        ALTER TABLE public.check_runs
          ADD COLUMN IF NOT EXISTS assignment_id uuid,
          ADD COLUMN IF NOT EXISTS device_id     text,
          ADD COLUMN IF NOT EXISTS status        text,
          ADD COLUMN IF NOT EXISTS severity      text,
          ADD COLUMN IF NOT EXISTS started_at    timestamptz,
          ADD COLUMN IF NOT EXISTS finished_at   timestamptz,
          ADD COLUMN IF NOT EXISTS metrics       jsonb,
          ADD COLUMN IF NOT EXISTS output        text,
          ADD COLUMN IF NOT EXISTS created_at    timestamptz DEFAULT now();
      `);

            // Valid unique key (no expressions): (target_type, target_id, dedupe_key)
            // Note: NULL dedupe_key won't conflict; we always write a normalized dedupe_key in code.
            await this.pg.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS check_assignments_target_dedupe_uk
        ON public.check_assignments (target_type, target_id, dedupe_key);
      `);

            await this.pg.query(`
        CREATE INDEX IF NOT EXISTS check_assignments_target_idx
        ON public.check_assignments (target_type, target_id);
      `);

            await this.pg.query(`CREATE INDEX IF NOT EXISTS check_runs_assignment_id_idx ON public.check_runs (assignment_id);`);
            await this.pg.query(`CREATE INDEX IF NOT EXISTS check_runs_device_id_idx     ON public.check_runs (device_id);`);
            await this.pg.query(`CREATE INDEX IF NOT EXISTS check_runs_created_at_idx    ON public.check_runs (created_at);`);

            this.schemaReady = true;
        })().finally(() => {
            this.schemaEnsuring = null;
        });

        return await this.schemaEnsuring;
    }

    /* ------------------------------------------------------------------------ */
    /* Helpers: resolve device target uuid                                       */
    /* ------------------------------------------------------------------------ */

    /**
     * Device pages in your app often use agents.id.
     * Assignments target devices via public.devices.id (uuid).
     *
     * This resolves:
     * - if input is a devices.id -> returns it
     * - else if input is an agents.id -> returns agents.device_id
     * - else returns null
     */
    private async resolveDeviceTargetUuid(deviceOrAgentId: string): Promise<string | null> {
        const raw = String(deviceOrAgentId ?? "").trim();
        if (!raw || !isUuid(raw)) return null;

        // devices.id?
        const asDevice = await this.pg.query<{ id: string }>(
            `SELECT d.id::text AS id FROM public.devices d WHERE d.id::text = $1 LIMIT 1`,
            [raw]
        );
        if (asDevice.rows?.[0]?.id) return asDevice.rows[0].id;

        // agents.id -> agents.device_id
        const asAgent = await this.pg.query<{ device_id: string | null }>(
            `SELECT a.device_id::text AS device_id FROM public.agents a WHERE a.id::text = $1 LIMIT 1`,
            [raw]
        );
        if (asAgent.rows?.[0]?.device_id) return asAgent.rows[0].device_id;

        return null;
    }

    /* ------------------------------------------------------------------------ */
    /* Public: UI listing                                                       */
    /* ------------------------------------------------------------------------ */

    async listByDevice(deviceOrAgentId: string, limit = 100): Promise<{ items: DeviceCheckDTO[] }> {
        if (!Number.isFinite(limit) || limit < 1) limit = 1;
        if (limit > 200) limit = 200;

        await this.ensureSchema();

        const deviceTargetId = await this.resolveDeviceTargetUuid(deviceOrAgentId);
        if (!deviceTargetId) return { items: [] };

        // target_type enum includes 'device' (confirmed)
        const TARGET_TYPE = "device";

        const sql = `
      WITH a AS (
        SELECT
          ca.id,
          ca.dedupe_key,
          ca.check_type,
          ca.check_name
        FROM public.check_assignments ca
        WHERE ca.target_type::text = $1
          AND ca.target_id = $2::uuid
      ),
      lr AS (
        SELECT
          cr.assignment_id,
          cr.status::text   AS status,
          cr.severity::text AS severity,
          cr.metrics        AS metrics,
          cr.output         AS output,
          cr.finished_at    AS last_run,
          ROW_NUMBER() OVER (
            PARTITION BY cr.assignment_id
            ORDER BY cr.finished_at DESC NULLS LAST, cr.created_at DESC NULLS LAST
          ) AS rn
        FROM public.check_runs cr
        JOIN a ON a.id = cr.assignment_id
      )
      SELECT
        a.id::text                            AS assignment_id,
        a.dedupe_key                          AS dedupe_key,
        a.check_type                          AS check_type,
        COALESCE(NULLIF(a.check_name,''), NULLIF(a.check_type,''), 'Check') AS check_name,
        lr.status                             AS run_status,
        lr.severity                           AS run_severity,
        lr.metrics                            AS run_metrics,
        lr.output                             AS run_output,
        lr.last_run                           AS last_run
      FROM a
      LEFT JOIN lr ON lr.assignment_id = a.id AND lr.rn = 1
      ORDER BY lr.last_run DESC NULLS LAST, check_name ASC
      LIMIT $3;
    `;

        try {
            const { rows } = await this.pg.query(sql, [TARGET_TYPE, deviceTargetId, limit]);

            const items: DeviceCheckDTO[] = (rows || []).map((r: any) => ({
                id: String(r.assignment_id),
                name: r.check_name ?? "Check",
                status: toUiStatus(r.run_status),
                lastRun: r.last_run ? new Date(r.last_run as any).toISOString() : null,
                output: (r.run_output ?? "").length > 8192
                    ? String(r.run_output ?? "").slice(0, 8192) + "…"
                    : (r.run_output ?? ""),

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

            // Be tolerant: if something is mid-migration, do not 500 the UI
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

        // Resolve target device UUID from agent id (preferred)
        const deviceTargetId = await this.resolveDeviceTargetUuid(input.agentId);
        if (!deviceTargetId) {
            this.log.warn(`ingestAgentRuns: unable to resolve device target from agentId=${input.agentId}`);
            return { inserted: 0, assignmentsCreated: 0 };
        }

        const TARGET_TYPE = "device";

        // ---- 1) Build source rows with ordinal
        const srcValues: string[] = [];
        const srcParams: any[] = [];
        let p = 1;

        for (let i = 0; i < input.runs.length; i++) {
            const r = input.runs[i];

            const type = (r.checkType ?? "").toString().trim().toUpperCase() || null;
            const name = ((r.checkName ?? type) ?? "Agent Check").toString().trim().slice(0, 200);

            const dkNorm = normalizeDedupeKey(r.dedupeKey ?? null, type, name);

            // (ord, target_type, target_id, dedupe_key, check_type, check_name)
            srcValues.push(`($${p++}::int, $${p++}::text, $${p++}::uuid, $${p++}::text, $${p++}::text, $${p++}::text)`);
            srcParams.push(i + 1, TARGET_TYPE, deviceTargetId, dkNorm, type, name);
        }

        // ---- 2) Upsert assignments by (target_type,target_id,dedupe_key)
        const upsertSql = `
      WITH src(ord, target_type, target_id, dedupe_key, check_type, check_name) AS (
        VALUES ${srcValues.join(",")}
      )
      INSERT INTO public.check_assignments (target_type, target_id, dedupe_key, check_type, check_name, updated_at)
      SELECT s.target_type, s.target_id, s.dedupe_key, s.check_type, s.check_name, now()
      FROM src s
      ON CONFLICT (target_type, target_id, dedupe_key)
      DO UPDATE SET
        check_type = EXCLUDED.check_type,
        check_name = EXCLUDED.check_name,
        updated_at = now()
      RETURNING id::text AS id;
    `;
        const upsertRes = await this.pg.query<{ id: string }>(upsertSql, srcParams);
        const assignmentsTouched = (upsertRes.rows || []).length;

        // ---- 3) Map assignment ids back by ord
        const mapSql = `
      WITH src(ord, target_type, target_id, dedupe_key, check_type, check_name) AS (
        VALUES ${srcValues.join(",")}
      )
      SELECT
        s.ord,
        ca.id::text AS assignment_id
      FROM src s
      JOIN public.check_assignments ca
        ON ca.target_type::text = s.target_type::text
       AND ca.target_id = s.target_id
       AND ca.dedupe_key = s.dedupe_key
      ORDER BY s.ord ASC;
    `;
        const mapRes = await this.pg.query<{ ord: number; assignment_id: string }>(mapSql, srcParams);
        const assignmentByOrd = new Map<number, string>();
        for (const r of mapRes.rows) assignmentByOrd.set(Number(r.ord), String(r.assignment_id));

        // ---- 4) Build run rows
        const runValues: string[] = [];
        const runParams: any[] = [];
        p = 1;

        for (let i = 0; i < input.runs.length; i++) {
            const r = input.runs[i];

            const mapped = assignmentByOrd.get(i + 1);
            const validUuid = r.assignmentId && isUuid(r.assignmentId);
            const assignmentId = validUuid ? r.assignmentId! : mapped;
            if (!assignmentId) continue;

            const status = normalizeStatus(r.status);
            const sevRaw = String(r.severity ?? "").trim().toLowerCase();
            const severity =
                sevRaw === "critical" || sevRaw === "crit" || sevRaw === "high" ? "critical"
                    : (sevRaw === "medium" ? "medium"
                        : (sevRaw === "low" ? "low"
                            : (sevRaw === "info" ? "info" : null)));

            const output = (r.output ?? "").toString().slice(0, MAX_OUTPUT);
            const startedAt = r.startedAt ? new Date(r.startedAt) : new Date();
            const finishedAt = r.finishedAt ? new Date(r.finishedAt) : new Date();

            runValues.push(`(
        $${p++}::uuid,        -- assignment_id
        $${p++}::text,        -- device_id (text; keep what you already use for agents)
        $${p++}::text,        -- status
        $${p++}::text,        -- severity
        $${p++}::jsonb,       -- metrics
        $${p++}::text,        -- output
        $${p++}::timestamptz, -- started_at
        $${p++}::timestamptz  -- finished_at
      )`);

            runParams.push(
                assignmentId,
                String(input.deviceId ?? ""), // keep agent/device text identifier as-is
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

        if (inserted > 0) this.scheduleDeviceBroadcast(String(input.deviceId ?? ""), inserted);

        this.log.log(`ingested ${inserted} run(s) for deviceText=${String(input.deviceId ?? "")}; assignments touched: ${assignmentsTouched}`);
        return { inserted, assignmentsCreated: assignmentsTouched };
    }

    /* ------------------------------------------------------------------------ */
    /* Optional: assignments listing (server-driven)                              */
    /* ------------------------------------------------------------------------ */

    async getAssignmentsForDevice(deviceOrAgentId: string): Promise<{
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

        const deviceTargetId = await this.resolveDeviceTargetUuid(deviceOrAgentId);
        if (!deviceTargetId) return { items: [] };

        const { rows } = await this.pg.query(
            `
      SELECT
        a.id::text   AS assignment_id,
        a.check_type AS check_type,
        a.check_name AS check_name,
        a.dedupe_key AS dedupe_key
      FROM public.check_assignments a
      WHERE a.target_type::text = 'device'
        AND a.target_id = $1::uuid
      ORDER BY a.created_at DESC;
      `,
            [deviceTargetId],
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
    /* WS broadcast (debounced per device text id)                               */
    /* ------------------------------------------------------------------------ */

    private scheduleDeviceBroadcast(deviceTextId: string, changed: number) {
        const key = String(deviceTextId);
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
