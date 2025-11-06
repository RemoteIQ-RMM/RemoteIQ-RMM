import { Controller, Get, UseGuards } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerm } from "../auth/require-perm.decorator";

@Controller("/api/admin/storage")
@UseGuards(PermissionsGuard)
export class StorageConnectionsLiteController {
    constructor(private readonly db: PgPoolService) { }

    @Get("connections")
    @RequirePerm("backups.manage")
    async list() {
        try {
            const exists = await this.db.query(
                `SELECT to_regclass('public.storage_connections') AS t`
            );
            if (!exists.rows?.[0]?.t) {
                // Table not present yet → return empty list (no dummy data, no crash)
                return { items: [] };
            }

            const sql = `
        SELECT id, name, kind
        FROM public.storage_connections
        WHERE kind IN ('s3','nextcloud','gdrive','sftp')
        ORDER BY name ASC
      `;
            const { rows } = await this.db.query(sql);
            return { items: rows.map((r: any) => ({ id: r.id, name: r.name, kind: r.kind })) };
        } catch {
            // Hardening: if anything DB-related blows up, don't crash the UI
            return { items: [] };
        }
    }
}
