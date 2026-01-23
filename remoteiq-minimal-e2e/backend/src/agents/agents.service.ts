// backend/src/agents/agents.service.ts
import { Injectable } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";

// DTOs are validated in controllers; here we accept partials safely.
type UpdateAgentFacts = Partial<{
    hostname: string;
    os: string;
    arch: string;
    version: string;
    primaryIp: string;
    user: string; // logged-in user
    loggedInUser: string; // alias
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
                `SELECT agent_uuid
           FROM public.agents
          WHERE id = $1::uuid
          LIMIT 1`,
                [agentId]
            );
            // If agent_uuid is empty/null, fall back to id as a useful stable display value
            const v = rows[0]?.agent_uuid ?? null;
            return v && String(v).trim() ? String(v) : String(agentId);
        } catch {
            return null;
        }
    }

    /**
     * Update agent facts and bump last_check_in_at (this powers "Last Response").
     * Schema-compatible with your agents table:
     *  - hostname (text) exists
     *  - version (text) exists
     *  - last_check_in_at (timestamptz) exists
     *  - facts (jsonb) exists and is where we store os/arch/user/primary_ip
     */
    async updateFacts(agentId: string, facts: UpdateAgentFacts): Promise<void> {
        const sets: string[] = [
            `last_check_in_at = NOW()`,
            `updated_at = NOW()`,
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

        // Update real columns if provided
        setIfDefined("hostname", facts.hostname);
        setIfDefined("version", facts.version);

        // Build facts patch (jsonb)
        const patch: Record<string, any> = {};

        if (facts.os !== undefined) patch.os = facts.os || null;
        if (facts.arch !== undefined) patch.arch = facts.arch || null;
        if (facts.primaryIp !== undefined) patch.primary_ip = facts.primaryIp || null;

        const loginUser = facts.user ?? facts.loggedInUser;
        if (loginUser !== undefined) {
            patch.user = loginUser || null;
            patch.logged_in_user = loginUser || null;
        }

        // Only apply facts merge if we have any keys
        const hasPatch = Object.keys(patch).length > 0;
        if (hasPatch) {
            // Merge existing facts with patch; patch values overwrite existing keys
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
     * (This avoids relying on ON CONFLICT for expression indexes and keeps behavior deterministic.)
     */
    async replaceSoftwareInventory(agentId: string, items: SoftwareItem[]): Promise<void> {
        if (!Array.isArray(items)) return;

        // Delete existing inventory first (simple + reliable)
        await this.pg.query(
            `DELETE FROM public.agent_software WHERE agent_id = $1::uuid`,
            [agentId]
        );

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
