import { Injectable, Logger } from "@nestjs/common";
import { PgPoolService } from "./pg-pool.service";

function slugify(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/--+/g, "-");
}

@Injectable()
export class OrganizationContextService {
    private readonly logger = new Logger(OrganizationContextService.name);
    private cachedOrgId: string | null = null;

    constructor(private readonly pg: PgPoolService) { }

    async getDefaultOrganizationId(): Promise<string> {
        if (this.cachedOrgId) return this.cachedOrgId;

        const configuredSlug = process.env.DEFAULT_ORGANIZATION_SLUG || "default";
        const slug = slugify(configuredSlug) || "default";
        const name = process.env.DEFAULT_ORGANIZATION_NAME || "Default Organization";

        try {
            const existing = await this.pg.query<{ id: string }>(
                `SELECT id FROM organizations WHERE slug = $1 LIMIT 1`,
                [slug],
            );
            if (existing.rows[0]?.id) {
                this.cachedOrgId = existing.rows[0].id;
                return this.cachedOrgId;
            }
        } catch (err) {
            this.logger.warn(`organizations table unavailable: ${(err as Error)?.message ?? err}`);
            throw err;
        }

        const insert = await this.pg.query<{ id: string }>(
            `INSERT INTO organizations (name, slug)
             VALUES ($1, $2)
             ON CONFLICT (slug) DO UPDATE
               SET name = EXCLUDED.name
             RETURNING id`,
            [name, slug],
        );

        const orgId = insert.rows[0].id;
        this.cachedOrgId = orgId;

        await this.pg.query(
            `INSERT INTO organization_settings (organization_id)
             VALUES ($1)
             ON CONFLICT (organization_id) DO NOTHING`,
            [orgId],
        );

        return orgId;
    }
}
