// remoteiq-minimal-e2e/backend/src/patches/patches.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";

export type PatchRow = {
    id: string;
    title: string;
    severity: string | null;
    requiresReboot: boolean;
    kbIds: string[];
    status: "Required" | "Installed" | "Pending";
};

type LatestPatchesResult = {
    ok: true;
    lastScanAt: string | null;
    patches: PatchRow[];
};

export type PatchHistoryItem = {
    taskId: string;
    runId: string;
    agentId: string;
    deviceId: string;

    status: "running" | "succeeded" | "failed" | "cancelled" | "queued" | "pending";

    startedAt: string;
    finishedAt: string | null;

    installed: string[];
    requiresReboot: boolean | null;

    createdBy: string | null;
    createdByName: string | null;
};

function asObject(v: any): Record<string, any> | null {
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

function asStringArray(v: any): string[] {
    if (!v) return [];
    if (Array.isArray(v)) return v.map((x) => String(x)).map((s) => s.trim()).filter(Boolean);
    return [];
}

function asBooleanOrNull(v: any): boolean | null {
    if (v === true) return true;
    if (v === false) return false;
    if (v == null) return null;

    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true") return true;
        if (s === "false") return false;
    }
    return null;
}

function quoteIdent(id: string): string {
    // Safe identifier quoting for dynamic SQL pieces.
    return `"${String(id).replace(/"/g, '""')}"`;
}

type UserJoinPlan = {
    tableSchema: string;
    tableName: string;
    displayExprSql: string; // SQL expression that yields a text display name, using alias "u".
};

@Injectable()
export class PatchesService {
    constructor(private readonly pg: PgPoolService) { }

    private async resolveAgentIdByDeviceId(deviceId: string): Promise<string> {
        const { rows } = await this.pg.query<{ id: string }>(
            `SELECT id::text AS id FROM public.agents WHERE device_id = $1::uuid LIMIT 1`,
            [deviceId],
        );
        const id = rows[0]?.id;
        if (!id) throw new NotFoundException("No agent is attached to this device yet.");
        return String(id);
    }

    async enqueueScan(deviceId: string, includeOptional: boolean, createdBy?: string | null) {
        const agentId = await this.resolveAgentIdByDeviceId(deviceId);

        const { rows } = await this.pg.query<{ id: string }>(
            `
      INSERT INTO public.agent_tasks (agent_id, type, payload, status, queued_at, created_by, created_at, updated_at)
      VALUES (
        $1::uuid,
        'patch_scan'::agent_task_type,
        jsonb_build_object('includeOptional', $2::boolean),
        'queued'::agent_task_status,
        now(),
        $3::uuid,
        now(),
        now()
      )
      RETURNING id::text AS id
      `,
            [agentId, !!includeOptional, createdBy ?? null],
        );

        return { accepted: true as const, taskId: rows[0]?.id ?? null };
    }

    async enqueueInstall(deviceId: string, includeOptional: boolean, ids: string[], createdBy?: string | null) {
        const agentId = await this.resolveAgentIdByDeviceId(deviceId);

        const { rows } = await this.pg.query<{ id: string }>(
            `
      INSERT INTO public.agent_tasks (agent_id, type, payload, status, queued_at, created_by, created_at, updated_at)
      VALUES (
        $1::uuid,
        'patch_install'::agent_task_type,
        jsonb_build_object('includeOptional', $2::boolean, 'ids', to_jsonb($3::text[])),
        'queued'::agent_task_status,
        now(),
        $4::uuid,
        now(),
        now()
      )
      RETURNING id::text AS id
      `,
            [agentId, !!includeOptional, ids, createdBy ?? null],
        );

        return { accepted: true as const, taskId: rows[0]?.id ?? null };
    }

    // ---- User display name detection (cached) --------------------------------

    private userJoinPlanCache: UserJoinPlan | null | undefined = undefined;

    private async detectUserJoinPlan(): Promise<UserJoinPlan | null> {
        // Prefer your real table first.
        const candidates: Array<{ schema: string; table: string }> = [
            { schema: "public", table: "users" },
            { schema: "public", table: "app_users" },
            { schema: "public", table: "user_accounts" },
        ];

        for (const c of candidates) {
            const colsRes = await this.pg.query<{ column_name: string }>(
                `
        SELECT column_name::text
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name   = $2
        `,
                [c.schema, c.table],
            );

            const cols = new Set((colsRes.rows ?? []).map((r) => String(r.column_name)));
            if (!cols.size) continue;
            if (!cols.has("id")) continue;

            // ✅ Your current schema has first_name, last_name, name, and email (USER-DEFINED).
            // Use a robust COALESCE chain.
            if (cols.has("first_name") && cols.has("last_name")) {
                const expr = `
          COALESCE(
            NULLIF(BTRIM(CONCAT_WS(' ', u.${quoteIdent("first_name")}::text, u.${quoteIdent("last_name")}::text)), ''),
            NULLIF(BTRIM(u.${quoteIdent("name")}::text), ''),
            NULLIF(BTRIM(u.${quoteIdent("email")}::text), ''),
            NULLIF(BTRIM((u.${quoteIdent("id")}::text)), '')
          )
        `.trim();

                return {
                    tableSchema: c.schema,
                    tableName: c.table,
                    displayExprSql: expr,
                };
            }

            // Prefer these "single field" name-ish columns if present.
            const preferredSingles = ["display_name", "full_name", "name", "username", "email"];
            for (const col of preferredSingles) {
                if (cols.has(col)) {
                    return {
                        tableSchema: c.schema,
                        tableName: c.table,
                        displayExprSql: `
              COALESCE(
                NULLIF(BTRIM(u.${quoteIdent(col)}::text), ''),
                NULLIF(BTRIM((u.${quoteIdent("id")}::text)), '')
              )
            `.trim(),
                    };
                }
            }

            // Last fallback: join works, but name will be null.
            return {
                tableSchema: c.schema,
                tableName: c.table,
                displayExprSql: `NULL`,
            };
        }

        return null;
    }

    private async getUserJoinPlan(): Promise<UserJoinPlan | null> {
        if (this.userJoinPlanCache !== undefined) return this.userJoinPlanCache;
        this.userJoinPlanCache = await this.detectUserJoinPlan();
        return this.userJoinPlanCache;
    }

    /**
     * Patch history for a device (all patch_install runs).
     * Pulls:
     * - status/timestamps from agent_task_runs
     * - installed ids + requiresReboot from:
     *    - agent_task_results.artifacts (schema-supported), OR
     *    - agent_task_runs.output.artifacts (controller merges artifacts into output), OR
     *    - agent_task_runs.output (fallback)
     * - createdByName via best-effort join to a users table (auto-detected)
     */
    async getHistory(deviceId: string, limit = 200): Promise<{ ok: true; items: PatchHistoryItem[] }> {
        const plan = await this.getUserJoinPlan();

        const joinSql = plan
            ? `LEFT JOIN ${quoteIdent(plan.tableSchema)}.${quoteIdent(plan.tableName)} u ON u.${quoteIdent("id")} = t.created_by`
            : ``;

        const selectCreatedByNameSql = plan
            ? `${plan.displayExprSql} AS created_by_name`
            : `NULL::text AS created_by_name`;

        const sql = `
SELECT
  t.id::text              AS task_id,
  r.id::text              AS run_id,
  t.agent_id::text        AS agent_id,
  a.device_id::text       AS device_id,
  r.status::text          AS status,
  r.started_at            AS started_at,
  r.finished_at           AS finished_at,
  r.output                AS output,
  rr.artifacts            AS artifacts,
  t.created_by::text      AS created_by,
  ${selectCreatedByNameSql}
FROM public.agent_tasks t
JOIN public.agent_task_runs r ON r.task_id = t.id
JOIN public.agents a ON a.id = t.agent_id
LEFT JOIN public.agent_task_results rr ON rr.run_id = r.id
${joinSql}
WHERE a.device_id = $1::uuid
  AND t.type = 'patch_install'::agent_task_type
ORDER BY COALESCE(r.finished_at, r.started_at) DESC, r.created_at DESC
LIMIT $2::int;
    `.trim();

        const { rows } = await this.pg.query<any>(sql, [deviceId, limit]);

        const items: PatchHistoryItem[] = (rows ?? []).map((row: any) => {
            const output = asObject(row.output);
            const rrArtifacts = asObject(row.artifacts);

            const installed = asStringArray(rrArtifacts?.installed ?? output?.artifacts?.installed ?? output?.installed);

            const requiresReboot = asBooleanOrNull(
                rrArtifacts?.requiresReboot ?? output?.artifacts?.requiresReboot ?? output?.requiresReboot,
            );

            const createdByName = row.created_by_name == null ? null : String(row.created_by_name);

            return {
                taskId: String(row.task_id),
                runId: String(row.run_id),
                agentId: String(row.agent_id),
                deviceId: String(row.device_id),

                status: String(row.status) as PatchHistoryItem["status"],

                startedAt: row.started_at ? new Date(row.started_at).toISOString() : new Date().toISOString(),
                finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,

                installed,
                requiresReboot,

                createdBy: row.created_by ? String(row.created_by) : null,
                createdByName: createdByName && createdByName.trim() ? createdByName.trim() : null,
            };
        });

        return { ok: true as const, items };
    }

    /**
     * Latest patch state for a device:
     * - Base list comes from latest successful patch_scan
     * - Mark Installed if found in latest successful patch_install
     * - Mark Pending if currently queued/running patch_install includes the id
     *
     * Handles artifacts stored either:
     * - in agent_task_runs.output.artifacts (controller merges artifacts into output), OR
     * - in agent_task_results.artifacts (schema-supported)
     */
    async getLatest(deviceId: string): Promise<LatestPatchesResult> {
        const agentId = await this.resolveAgentIdByDeviceId(deviceId);

        // 1) Latest successful scan (patches list)
        const scanRes = await this.pg.query<{
            last_scan_at: string | null;
            output: any;
            artifacts: any | null;
        }>(
            `
      SELECT
        r.finished_at::text AS last_scan_at,
        r.output AS output,
        rr.artifacts AS artifacts
      FROM public.agent_tasks t
      JOIN public.agent_task_runs r ON r.task_id = t.id
      LEFT JOIN public.agent_task_results rr ON rr.run_id = r.id
      WHERE t.agent_id = $1::uuid
        AND t.type = 'patch_scan'::agent_task_type
        AND r.status::text = 'succeeded'
      ORDER BY r.finished_at DESC NULLS LAST, r.created_at DESC
      LIMIT 1
      `,
            [agentId],
        );

        const scanRow = scanRes.rows[0] ?? null;

        // If no scan yet, return empty (but still ok)
        if (!scanRow) {
            return { ok: true, lastScanAt: null, patches: [] };
        }

        const out = asObject(scanRow.output);
        const rrArtifacts = asObject(scanRow.artifacts);

        // Prefer task_results.artifacts.patches, else output.artifacts.patches, else output.patches
        const rawPatches = Array.isArray(rrArtifacts?.patches)
            ? rrArtifacts!.patches
            : Array.isArray(out?.artifacts?.patches)
                ? out!.artifacts.patches
                : Array.isArray(out?.patches)
                    ? out!.patches
                    : [];

        const base: PatchRow[] = rawPatches
            .map((p: any, i: number) => ({
                id: String(p?.id ?? `patch-${i}`),
                title: String(p?.title ?? ""),
                severity: p?.severity == null ? null : String(p.severity),
                requiresReboot: !!p?.requiresReboot,
                kbIds: Array.isArray(p?.kbIds) ? p.kbIds.map((x: any) => String(x)) : [],
                status: "Required" as const,
            }))
            .filter((p: PatchRow) => !!p.id);

        // 2) Latest successful install (installed ids)
        const installRes = await this.pg.query<{
            output: any;
            artifacts: any | null;
        }>(
            `
      SELECT
        r.output AS output,
        rr.artifacts AS artifacts
      FROM public.agent_tasks t
      JOIN public.agent_task_runs r ON r.task_id = t.id
      LEFT JOIN public.agent_task_results rr ON rr.run_id = r.id
      WHERE t.agent_id = $1::uuid
        AND t.type = 'patch_install'::agent_task_type
        AND r.status::text = 'succeeded'
      ORDER BY r.finished_at DESC NULLS LAST, r.created_at DESC
      LIMIT 1
      `,
            [agentId],
        );

        const installRow = installRes.rows[0] ?? null;
        const installOut = asObject(installRow?.output);
        const installArtifacts = asObject(installRow?.artifacts);

        const installedIds = new Set(
            asStringArray(installArtifacts?.installed ?? installOut?.artifacts?.installed ?? installOut?.installed).map((s) =>
                s.toLowerCase(),
            ),
        );

        // 3) Any queued/running install payload ids => Pending
        const pendingRes = await this.pg.query<{ ids: string[] }>(
            `
      SELECT COALESCE((
        SELECT array_agg(x)::text[]
        FROM (
          SELECT jsonb_array_elements_text(t.payload->'ids') AS x
          FROM public.agent_tasks t
          WHERE t.agent_id = $1::uuid
            AND t.type = 'patch_install'::agent_task_type
            AND t.status IN ('pending'::agent_task_status, 'queued'::agent_task_status, 'running'::agent_task_status)
        ) z
      ), '{}'::text[]) AS ids
      `,
            [agentId],
        );

        const pendingIds = new Set(
            (pendingRes.rows[0]?.ids ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean),
        );

        // Apply status overlays: Installed > Pending > Required
        const patches = base.map((p) => {
            const key = p.id.toLowerCase();
            if (installedIds.has(key)) return { ...p, status: "Installed" as const };
            if (pendingIds.has(key)) return { ...p, status: "Pending" as const };
            return p;
        });

        return {
            ok: true,
            lastScanAt: scanRow.last_scan_at ?? null,
            patches,
        };
    }
}
