// backend/src/agents/agents.service.ts
import { Injectable } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";

// Controller DTOs validated already; service accepts partials safely.
type UpdateAgentFacts = Partial<{
    hostname: string;
    os: string;
    arch: string;
    version: string;
    primaryIp: string;
    user: string; // logged-in user
    loggedInUser: string; // alias

    // ✅ NEW: agent device summary blob (hardware/disks/etc)
    facts: Record<string, any>;
}>;

type SoftwareItem = {
    name: string;
    version?: string | null;
    publisher?: string | null;
    installDate?: string | null; // YYYY-MM-DD
};

@Injectable()
export class AgentsService {
    constructor(private readonly pg: PgPoolService) { }

    /** Return the stable UUID mirror for a uuid agent id (or null if absent). */
    async getAgentUuidById(agentId: string): Promise<string | null> {
        try {
            const { rows } = await this.pg.query<{ agent_uuid: string | null }>(
                `
        SELECT agent_uuid
          FROM public.agents
         WHERE id = $1::uuid
         LIMIT 1
        `,
                [agentId]
            );

            const v = rows[0]?.agent_uuid ?? null;
            return v && String(v).trim() ? String(v) : String(agentId);
        } catch {
            return null;
        }
    }

    /**
     * Update agent facts and bump last_check_in_at (powers "Last Response").
     *
     * Your schema (public.agents):
     *  - hostname           text NULL
     *  - version            text NOT NULL
     *  - last_check_in_at   timestamptz NULL
     *  - facts              jsonb NOT NULL DEFAULT '{}'
     *  - agent_uuid         text NOT NULL UNIQUE
     */
    async updateFacts(agentId: string, facts: UpdateAgentFacts): Promise<void> {
        const sets: string[] = [
            `last_check_in_at = NOW()`,
            `updated_at = NOW()`,
            // keep agent_uuid stable + non-empty (your column is NOT NULL + UNIQUE)
            `agent_uuid = COALESCE(NULLIF(agent_uuid, ''), id::text)`,
        ];

        const params: any[] = [];
        let p = 1;

        const setIfDefined = (col: string, val: any) => {
            if (val !== undefined) {
                sets.push(`${col} = $${p++}`);
                params.push(val);
            }
        };

        // Real columns
        setIfDefined("hostname", facts.hostname);
        setIfDefined("version", facts.version);

        /**
         * Build ONE jsonb patch, then assign facts once.
         * - basic keys used elsewhere in backend: os/arch/primary_ip/user/logged_in_user
         * - device summary blob stored under facts.device (hardware/disks/etc)
         */
        const patch: Record<string, any> = {};

        if (facts.os !== undefined) patch.os = facts.os || null;
        if (facts.arch !== undefined) patch.arch = facts.arch || null;
        if (facts.primaryIp !== undefined) patch.primary_ip = facts.primaryIp || null;

        const loginUser = facts.user ?? facts.loggedInUser;
        if (loginUser !== undefined) {
            patch.user = loginUser || null;
            patch.logged_in_user = loginUser || null;
        }

        // ✅ store the device summary blob under facts.device
        if (facts.facts !== undefined) {
            // if someone sends null/empty, we’ll store null to “clear” it
            patch.device = facts.facts && typeof facts.facts === "object" ? facts.facts : null;
        }

        if (Object.keys(patch).length > 0) {
            // IMPORTANT: facts assigned exactly once
            sets.push(`facts = COALESCE(facts, '{}'::jsonb) || $${p++}::jsonb`);
            params.push(JSON.stringify(patch));
        }

        const sql = `
      UPDATE public.agents
         SET ${sets.join(", ")}
       WHERE id = $${p}::uuid
    `;
        params.push(agentId);

        await this.pg.query(sql, params);
    }

    /**
     * Replace full software inventory for an agent.
     */
    async replaceSoftwareInventory(agentId: string, items: SoftwareItem[]): Promise<void> {
        if (!Array.isArray(items)) return;

        await this.pg.query(`DELETE FROM public.agent_software WHERE agent_id = $1::uuid`, [agentId]);

        const cleaned: SoftwareItem[] = items
            .map((it) => ({
                name: (it.name || "").trim(),
                version: it.version ?? null,
                publisher: it.publisher ?? null,
                installDate: it.installDate ?? null,
            }))
            .filter((it) => !!it.name);

        if (cleaned.length === 0) return;

        const valuesSql: string[] = [];
        const params: any[] = [];
        let p = 1;

        for (const it of cleaned) {
            valuesSql.push(`(
        $${p++}::uuid,
        $${p++}::text,
        $${p++}::text,
        $${p++}::text,
        $${p++}::timestamptz
      )`);

            params.push(
                agentId,
                it.name,
                it.version ?? null,
                it.publisher ?? null,
                it.installDate ? new Date(it.installDate) : null
            );
        }

        const sql = `
      INSERT INTO public.agent_software (agent_id, name, version, publisher, install_date)
      VALUES ${valuesSql.join(",")}
    `;
        await this.pg.query(sql, params);
    }
}
