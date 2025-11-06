import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PgPoolService } from "../storage/pg-pool.service";
import {
    ALL_PERMISSIONS,
    PERMISSION_DEFINITIONS,
    PERMISSION_GROUPS,
    PermissionDefinition,
    rolePermissions,
} from "../auth/policy";

export type PermissionGroupDto = {
    key: string;
    label: string;
    items: { key: string; label: string; description?: string }[];
};

@Injectable()
export class PermissionsIntrospectService implements OnModuleInit {
    private readonly logger = new Logger(PermissionsIntrospectService.name);

    constructor(private readonly db: PgPoolService) { }

    async onModuleInit(): Promise<void> {
        try {
            const tablesReady = await this.ensureAclTablesExist();
            if (!tablesReady) return;
            await this.syncPermissionCatalog();
            await this.ensureBuiltInRoles();
        } catch (err) {
            this.logger.warn(`Failed to seed permissions catalog: ${(err as Error)?.message ?? err}`);
        }
    }

    listDistinctPermissionKeys(): Promise<string[]> {
        return Promise.resolve([...ALL_PERMISSIONS]);
    }

    listPermissionDefinitions(): Promise<PermissionDefinition[]> {
        return Promise.resolve([...PERMISSION_DEFINITIONS]);
    }

    listPermissionGroups(): Promise<PermissionGroupDto[]> {
        const groups: PermissionGroupDto[] = PERMISSION_GROUPS.map((group) => ({
            key: group.key,
            label: group.label,
            items: group.items.map((item) => ({
                key: item.key,
                label: item.label,
                description: item.description,
            })),
        }));
        return Promise.resolve(groups);
    }

    private async ensureAclTablesExist(): Promise<boolean> {
        const { rows } = await this.db.query(
            `SELECT
         to_regclass('public.permissions')  AS permissions,
         to_regclass('public.role_permissions') AS role_permissions,
         to_regclass('public.role_meta') AS role_meta,
         to_regclass('public.roles') AS roles`
        );
        const hasAll = Boolean(
            rows?.[0]?.permissions && rows?.[0]?.role_permissions && rows?.[0]?.roles && rows?.[0]?.role_meta
        );
        if (!hasAll) {
            this.logger.warn("ACL tables missing; skip permission seeding until migrations run.");
        }
        return hasAll;
    }

    private async syncPermissionCatalog(): Promise<void> {
        const payload = JSON.stringify(
            PERMISSION_DEFINITIONS.map((d) => ({
                key: d.key,
                label: d.label,
                group_key: d.groupKey,
                group_label: d.groupLabel,
            }))
        );

        await this.db.query(
            `WITH defs AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb)
          AS x(key text, label text, group_key text, group_label text)
      )
      INSERT INTO public.permissions (key, label, group_key, group_label)
      SELECT key, label, group_key, group_label
      FROM defs
      ON CONFLICT (key) DO UPDATE
        SET label = EXCLUDED.label,
            group_key = EXCLUDED.group_key,
            group_label = EXCLUDED.group_label`,
            [payload]
        );
    }

    private async ensureBuiltInRoles(): Promise<void> {
        const defaults: Array<{ name: string; description: string; perms: string[] }> = [
            { name: "Owner", description: "Full system access", perms: rolePermissions.owner },
            { name: "Admin", description: "Administrative access", perms: rolePermissions.admin },
        ];

        for (const def of defaults) {
            const res = await this.db.query<{ id: string }>(
                `SELECT id FROM public.roles WHERE lower(name)=lower($1) LIMIT 1`,
                [def.name]
            );

            let roleId = res.rows?.[0]?.id;
            if (!roleId) {
                roleId = randomUUID();
                await this.db.query(
                    `INSERT INTO public.roles (id, name, description) VALUES ($1, $2, $3)`,
                    [roleId, def.name, def.description]
                );
            } else {
                await this.db.query(`UPDATE public.roles SET description = COALESCE(description, $2) WHERE id=$1`, [
                    roleId,
                    def.description,
                ]);
            }

            await this.db.query(
                `INSERT INTO public.role_meta (role_name, description, permissions)
         VALUES ($1, $2, $3::text[])
         ON CONFLICT (role_name) DO UPDATE
           SET permissions = EXCLUDED.permissions,
               updated_at = now()`,
                [def.name, def.description, def.perms]
            );

            await this.db.query(
                `DELETE FROM public.role_permissions
         WHERE role_id = $1
           AND permission_id NOT IN (
             SELECT id FROM public.permissions WHERE key = ANY($2::text[])
           )`,
                [roleId, def.perms]
            );

            await this.db.query(
                `INSERT INTO public.role_permissions (role_id, permission_id)
         SELECT $1, p.id
         FROM public.permissions p
         WHERE p.key = ANY($2::text[])
           AND NOT EXISTS (
             SELECT 1 FROM public.role_permissions rp
             WHERE rp.role_id = $1 AND rp.permission_id = p.id
           )`,
                [roleId, def.perms]
            );
        }
    }
}
