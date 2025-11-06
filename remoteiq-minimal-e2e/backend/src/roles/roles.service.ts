import {
    Injectable,
    BadRequestException,
    NotFoundException,
    ConflictException,
} from '@nestjs/common';
import { PgPoolService } from '../storage/pg-pool.service';
import { OrganizationContextService } from '../storage/organization-context.service';
import { ALL_PERMISSIONS, Permission } from '../auth/policy';

export type RoleDto = {
    id: string;
    name: string;
    description?: string;
    permissions: string[];
    usersCount: number;
    createdAt: string;
    updatedAt: string;
};

export type CreateRoleDto = {
    name: string;
    description?: string;
    permissions?: string[];
};

export type UpdateRoleDto = Partial<{
    name: string;
    description: string | null;
    permissions: string[]; // full replace
}>;

const PROTECTED_NAMES = new Set(['owner', 'admin']);
const FULL_LOCK_NAME = 'owner';
const VALID_PERMISSIONS = new Set<Permission>(ALL_PERMISSIONS);

type RoleRecord = {
    id: string;
    name: string;
    scope: 'system' | 'organization';
    organization_id: string | null;
    description: string | null;
};

function isUuid(v: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizePermissions(perms?: string[]): Permission[] {
    if (!perms || !perms.length) return [];
    const invalid: string[] = [];
    const out = new Set<Permission>();

    for (const raw of perms) {
        if (!raw) continue;
        const key = raw.trim().toLowerCase() as Permission;
        if (!VALID_PERMISSIONS.has(key)) {
            invalid.push(raw);
            continue;
        }
        out.add(key);
    }

    if (invalid.length) {
        throw new BadRequestException(`Unknown permission(s): ${invalid.join(', ')}`);
    }

    return Array.from(out);
}

@Injectable()
export class RolesService {
    constructor(
        private readonly db: PgPoolService,
        private readonly orgs: OrganizationContextService,
    ) { }

    async list(): Promise<RoleDto[]> {
        const orgId = await this.orgs.getDefaultOrganizationId();
        const sql = `
      SELECT
        r.id,
        r.name,
        COALESCE(r.description, '') AS description,
        COALESCE(array_agg(DISTINCT rp.permission_key)
                 FILTER (WHERE rp.permission_key IS NOT NULL),
                 '{}'::text[]) AS permissions,
        (
          SELECT COUNT(*)::int
          FROM public.user_roles ur
          WHERE ur.role_id = r.id
        ) AS "usersCount",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt"
      FROM public.roles r
      LEFT JOIN public.role_permissions rp
        ON rp.role_id = r.id
      WHERE
        (r.scope = 'system')
        OR (r.organization_id = $1)
      GROUP BY r.id
      ORDER BY lower(r.name) ASC;
    `;
        const { rows } = await this.db.query(sql, [orgId]);
        return rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            description: r.description ?? undefined,
            permissions: Array.isArray(r.permissions) ? r.permissions : [],
            usersCount: Number(r.usersCount ?? 0),
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }));
    }

    async create(payload: CreateRoleDto): Promise<{ id: string }> {
        const name = (payload.name ?? '').trim();
        if (name.length < 2 || name.length > 64) {
            throw new BadRequestException('Name must be 2–64 characters.');
        }

        const orgId = await this.orgs.getDefaultOrganizationId();
        const exists = await this.db.query(
            `SELECT 1
         FROM public.roles
        WHERE lower(name) = lower($2)
          AND ((scope = 'organization' AND organization_id = $1) OR scope = 'system')
        LIMIT 1;`,
            [orgId, name],
        );
        if ((exists.rows?.length ?? 0) > 0) {
            throw new ConflictException('Role name must be unique (case-insensitive).');
        }

        const desc = payload.description?.trim() || null;
        const perms = normalizePermissions(payload.permissions);

        const insRole = await this.db.query(
            `INSERT INTO public.roles (organization_id, scope, name, description)
             VALUES ($1, 'organization', $2, $3)
             RETURNING id;`,
            [orgId, name, desc],
        );
        const id = insRole.rows[0].id as string;

        await this.replaceRolePermissions(id, perms);

        return { id };
    }

    async getById(id: string): Promise<{ id: string; name: string }> {
        if (!isUuid(id)) throw new BadRequestException('Invalid role id.');
        const role = await this.fetchRoleById(id);
        return { id: role.id, name: role.name };
    }

    async update(id: string, patch: UpdateRoleDto): Promise<void> {
        const { name: newNameRaw, description, permissions } = patch;
        const role = await this.fetchRoleById(id);

        const oldLower = role.name.trim().toLowerCase();
        const normalizedPerms = permissions === undefined ? null : normalizePermissions(permissions ?? []);

        if (newNameRaw !== undefined) {
            const newName = newNameRaw.trim();
            if (newName.length < 2 || newName.length > 64) {
                throw new BadRequestException('Name must be 2–64 characters.');
            }
            if (role.scope === 'system' || oldLower === FULL_LOCK_NAME) {
                throw new BadRequestException('The "Owner" role cannot be renamed.');
            }
            if (newName.toLowerCase() !== oldLower) {
                const exists = await this.db.query(
                    `SELECT 1
             FROM public.roles
            WHERE id <> $1
              AND lower(name)=lower($2)
              AND ((scope='organization' AND organization_id = $3) OR scope='system')
            LIMIT 1;`,
                    [id, newName, role.organization_id],
                );
                if ((exists.rows?.length ?? 0) > 0) {
                    throw new ConflictException('Role name must be unique (case-insensitive).');
                }

                await this.db.query(`UPDATE public.roles SET name=$1 WHERE id=$2;`, [newName, id]);
                role.name = newName;
            }
        }

        if (description !== undefined) {
            await this.db.query(
                `UPDATE public.roles SET description = $1 WHERE id = $2`,
                [description ?? null, id],
            );
        }

        if (normalizedPerms !== null) {
            await this.replaceRolePermissions(id, normalizedPerms);
        }
    }

    async remove(roleId: string): Promise<void> {
        if (!isUuid(roleId)) throw new BadRequestException('Invalid role id.');

        const role = await this.fetchRoleById(roleId);
        const lower = role.name.trim().toLowerCase();
        if (role.scope === 'system' || PROTECTED_NAMES.has(lower)) {
            throw new BadRequestException('This role is protected and cannot be deleted.');
        }

        const assigned = await this.db.query(
            `SELECT 1 FROM public.user_roles WHERE role_id = $1 LIMIT 1;`,
            [roleId],
        );
        if (assigned.rows.length > 0) {
            throw new BadRequestException('Cannot delete a role that still has users assigned.');
        }

        await this.db.query(`DELETE FROM public.roles WHERE id=$1;`, [roleId]);
    }

    private async replaceRolePermissions(roleId: string, permissions: Permission[]): Promise<void> {
        await this.db.query(`DELETE FROM public.role_permissions WHERE role_id=$1;`, [roleId]);
        if (!permissions.length) return;
        await this.db.query(
            `INSERT INTO public.role_permissions (role_id, permission_key)
             SELECT $1, perm
             FROM unnest($2::text[]) AS perm`,
            [roleId, permissions],
        );
    }

    private async fetchRoleById(id: string): Promise<RoleRecord> {
        const { rows } = await this.db.query<RoleRecord>(
            `SELECT id, name, scope, organization_id, description
             FROM public.roles
             WHERE id = $1
             LIMIT 1`,
            [id],
        );
        if (!rows.length) throw new NotFoundException('Role not found.');
        return rows[0];
    }
}
