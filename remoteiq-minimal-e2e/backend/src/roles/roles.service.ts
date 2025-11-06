import {
    Injectable,
    BadRequestException,
    NotFoundException,
    ConflictException,
} from '@nestjs/common';
import { PgPoolService } from '../storage/pg-pool.service';
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
        throw new BadRequestException(`Unknown permission(s): ${invalid.join(", ")}`);
    }

    return Array.from(out);
}

@Injectable()
export class RolesService {
    constructor(private readonly db: PgPoolService) { }

    async list(): Promise<RoleDto[]> {
        const sql = `
      SELECT
        r.id,
        r.name,
        COALESCE(rm.description, '') AS description,
        COALESCE(rp.permissions, rm.permissions, '{}'::text[]) AS permissions,
        (
          SELECT COUNT(*)::int
          FROM public.users u
          WHERE lower(u.role) = lower(r.name)
        ) AS "usersCount",
        r.created_at AS "createdAt",
        COALESCE(rm.updated_at, r.created_at) AS "updatedAt"
      FROM public.roles r
      LEFT JOIN public.role_meta rm
        ON rm.role_name = r.name
      LEFT JOIN LATERAL (
        SELECT COALESCE(array_agg(p.key ORDER BY p.key), '{}'::text[]) AS permissions
        FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = r.id
      ) rp ON TRUE
      ORDER BY lower(r.name) ASC;
    `;
        const { rows } = await this.db.query(sql);
        return rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            description: r.description ?? undefined,
            permissions: r.permissions ?? [],
            usersCount: r.usersCount ?? 0,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
        }));
    }

    async create(payload: CreateRoleDto): Promise<{ id: string }> {
        const name = (payload.name ?? '').trim();
        if (name.length < 2 || name.length > 64) {
            throw new BadRequestException('Name must be 2–64 characters.');
        }
        // Case-insensitive uniqueness check
        const exists = await this.db.query(
            `SELECT 1 FROM public.roles WHERE lower(name)=lower($1) LIMIT 1;`,
            [name],
        );
        if ((exists.rows?.length ?? 0) > 0) {
            throw new ConflictException('Role name must be unique (case-insensitive).');
        }

        const desc = payload.description?.trim() || null;
        const perms = normalizePermissions(payload.permissions);

        // Create role
        const insRole = await this.db.query(
            `INSERT INTO public.roles (name) VALUES ($1) RETURNING id;`,
            [name],
        );
        const id = insRole.rows[0].id as string;

        // Upsert meta for description + permissions
        await this.db.query(
            `INSERT INTO public.role_meta (role_name, description, permissions)
       VALUES ($1, $2, $3::text[])
       ON CONFLICT (role_name) DO UPDATE SET
         description = EXCLUDED.description,
         permissions = EXCLUDED.permissions,
         updated_at  = now();`,
            [name, desc, perms],
        );

        await this.replaceRolePermissions(id, perms);

        return { id };
    }

    async getById(id: string): Promise<{ id: string; name: string }> {
        if (!isUuid(id)) throw new BadRequestException('Invalid role id.');
        const { rows } = await this.db.query(`SELECT id, name FROM public.roles WHERE id=$1;`, [id]);
        if (!rows.length) throw new NotFoundException('Role not found.');
        return rows[0];
    }

    async update(id: string, patch: UpdateRoleDto): Promise<void> {
        const { name: newNameRaw, description, permissions } = patch;
        const role = await this.getById(id);
        const oldLower = role.name.trim().toLowerCase();
        const normalizedPerms = permissions === undefined ? null : normalizePermissions(permissions ?? []);

        if (newNameRaw !== undefined) {
            const newName = newNameRaw.trim();
            if (newName.length < 2 || newName.length > 64) {
                throw new BadRequestException('Name must be 2–64 characters.');
            }
            if (oldLower === FULL_LOCK_NAME) {
                throw new BadRequestException('The "Owner" role cannot be renamed.');
            }
            if (newName.toLowerCase() !== oldLower) {
                // case-insensitive uniqueness
                const exists = await this.db.query(
                    `SELECT 1 FROM public.roles WHERE id <> $1 AND lower(name)=lower($2) LIMIT 1;`,
                    [id, newName],
                );
                if ((exists.rows?.length ?? 0) > 0) {
                    throw new ConflictException('Role name must be unique (case-insensitive).');
                }

                // Rename role and align meta.role_name
                await this.db.query(`UPDATE public.roles SET name=$1 WHERE id=$2;`, [newName, id]);
                await this.db.query(
                    `UPDATE public.role_meta SET role_name=$1, updated_at=now() WHERE role_name=$2;`,
                    [newName, role.name],
                );
                role.name = newName; // keep local variable coherent for later meta updates
            }
        }

        // Upsert/Update meta fields if provided
        if (description !== undefined || permissions !== undefined) {
            const descVal = description === undefined ? null : (description ?? null);
            const permsVal = normalizedPerms;

            // Ensure row exists for current role.name
            await this.db.query(
                `INSERT INTO public.role_meta (role_name, description, permissions)
         VALUES ($1, COALESCE($2,'')::text, COALESCE($3,'{}'::text[])::text[])
         ON CONFLICT (role_name) DO NOTHING;`,
                [role.name, descVal ?? '', permsVal ?? []],
            );

            // Build dynamic SET based on provided fields
            const sets: string[] = [];
            const params: any[] = [];

            if (description !== undefined) {
                params.push(descVal);
                sets.push(`description = $${params.length}`);
            }
            if (permissions !== undefined) {
                params.push(permsVal ?? []);
                sets.push(`permissions = $${params.length}::text[]`);
            }
            sets.push(`updated_at = now()`);

            await this.db.query(
                `UPDATE public.role_meta SET ${sets.join(', ')} WHERE role_name=$${params.length + 1};`,
                [...params, role.name],
            );
        }

        if (normalizedPerms !== null) {
            await this.replaceRolePermissions(id, normalizedPerms);
        }
    }

    async remove(id: string): Promise<void> {
        const role = await this.getById(id);
        const lower = role.name.trim().toLowerCase();

        if (PROTECTED_NAMES.has(lower)) {
            throw new BadRequestException('Protected roles cannot be deleted.');
        }

        // Block delete if any users currently assigned (users.role text)
        const count = await this.db.query(
            `SELECT COUNT(*)::int AS c FROM public.users WHERE lower(role)=lower($1);`,
            [role.name],
        );
        const assigned = (count.rows?.[0]?.c as number) ?? 0;
        if (assigned > 0) {
            throw new BadRequestException('Role is in use by one or more users. Reassign users first.');
        }

        // Delete role; role_meta has FK ON DELETE CASCADE to roles.name
        await this.db.query(`DELETE FROM public.roles WHERE id=$1;`, [id]);
    }

    private async replaceRolePermissions(roleId: string, permissions: Permission[]): Promise<void> {
        await this.db.query(`DELETE FROM public.role_permissions WHERE role_id=$1;`, [roleId]);
        if (!permissions.length) return;

        const existing = await this.db.query<{ key: string }>(
            `SELECT key FROM public.permissions WHERE key = ANY($1::text[])`,
            [permissions]
        );
        const found = new Set(existing.rows.map((row) => row.key));
        const missing = permissions.filter((p) => !found.has(p));
        if (missing.length) {
            throw new BadRequestException(`Permissions not provisioned in catalog: ${missing.join(", ")}`);
        }

        await this.db.query(
            `INSERT INTO public.role_permissions (role_id, permission_id)
       SELECT $1, p.id
       FROM public.permissions p
       WHERE p.key = ANY($2::text[])`,
            [roleId, permissions]
        );
    }
}
