//remoteiq-minimal-e2e\backend\src\roles\permissions-introspect.service.ts

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PgPoolService } from "../storage/pg-pool.service";
import { OrganizationContextService } from "../storage/organization-context.service";
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

    constructor(
        private readonly db: PgPoolService,
        private readonly orgs: OrganizationContextService,
    ) { }

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
         to_regclass('public.user_roles') AS user_roles,
         to_regclass('public.roles') AS roles`
        );
        const hasAll = Boolean(
            rows?.[0]?.permissions && rows?.[0]?.role_permissions && rows?.[0]?.roles && rows?.[0]?.user_roles
        );
        if (!hasAll) {
            this.logger.warn("ACL tables missing; skip permission seeding until migrations run.");
        }
        return hasAll;
    }

    private async syncPermissionCatalog(): Promise<void> {
        const payload = JSON.stringify(
            PERMISSION_DEFINITIONS.map((d) => ({
                permission_key: d.key,
                label: d.label,
                group_key: d.groupKey,
                group_label: d.groupLabel,
            }))
        );

        await this.db.query(
            `WITH defs AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb)
          AS x(permission_key text, label text, group_key text, group_label text)
      )
      INSERT INTO public.permissions (permission_key, label, group_key, group_label)
      SELECT permission_key, label, group_key, group_label
      FROM defs
      ON CONFLICT (permission_key) DO UPDATE
        SET label = EXCLUDED.label,
            group_key = EXCLUDED.group_key,
            group_label = EXCLUDED.group_label`,
            [payload],
        );
    }

    private async ensureBuiltInRoles(): Promise<void> {
        const orgId = await this.orgs.getDefaultOrganizationId();
        const defaults: Array<{ name: string; description: string; perms: string[] }> = [
            { name: "Owner", description: "Full system access", perms: rolePermissions.owner },
            { name: "Admin", description: "Administrative access", perms: rolePermissions.admin },
        ];

        for (const def of defaults) {
            const res = await this.db.query<{ id: string }>(
                `SELECT id FROM public.roles
                 WHERE lower(name)=lower($1)
                   AND ((scope='organization' AND organization_id=$2) OR scope='system')
                 LIMIT 1`,
                [def.name, orgId]
            );

            let roleId = res.rows?.[0]?.id;
            if (!roleId) {
                roleId = randomUUID();
                await this.db.query(
                    `INSERT INTO public.roles (id, organization_id, scope, name, description)
                     VALUES ($1, $2, 'organization', $3, $4)
                     ON CONFLICT (id) DO NOTHING`,
                    [roleId, orgId, def.name, def.description]
                );
            } else {
                await this.db.query(
                    `UPDATE public.roles
                        SET description = COALESCE($2, description)
                      WHERE id = $1`,
                    [roleId, def.description],
                );
            }

            await this.replacePermissions(roleId, def.perms);
        }
    }

    private async replacePermissions(roleId: string, perms: string[]): Promise<void> {
        await this.db.query(`DELETE FROM public.role_permissions WHERE role_id = $1`, [roleId]);
        if (!perms.length) return;
        await this.db.query(
            `INSERT INTO public.role_permissions (role_id, permission_key)
             SELECT $1, perm
             FROM unnest($2::text[]) AS perm`,
            [roleId, perms],
        );
    }
}
