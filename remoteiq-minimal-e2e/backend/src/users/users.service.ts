// backend/src/users/users.service.ts
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { PgPoolService } from "../storage/pg-pool.service";
import { OrganizationContextService } from "../storage/organization-context.service";
import {
    BulkInviteDto,
    CreateUserDto,
    InviteUserDto,
    ListUsersQuery,
    ResetPasswordDto,
    UpdateRoleDto,
    UpdateUserDto,
    UserRow,
} from "./users.dto";

const SALT_ROUNDS = 12;
const NAME_SPLIT_REGEX = /\s+/;
const DEFAULT_ROLE_CANDIDATES = ["user", "technician", "admin"];

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function coalesceString(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed.length ? trimmed : null;
}

function splitDisplayName(name: string | undefined | null): { first: string | null; last: string | null } {
    if (!name) return { first: null, last: null };
    const trimmed = name.trim();
    if (!trimmed) return { first: null, last: null };
    const parts = trimmed.split(NAME_SPLIT_REGEX).filter(Boolean);
    if (parts.length === 0) return { first: null, last: null };
    if (parts.length === 1) return { first: parts[0], last: null };
    const last = parts.pop() as string;
    return { first: parts.join(" "), last };
}

type DbUserRow = {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    status: string;
    last_seen_at: string | null;
    created_at: string;
    updated_at: string;
    two_factor_enabled: boolean;
    primary_role_id: string | null;
    primary_role_name: string | null;
    roles: any;
};

@Injectable()
export class UsersService {
    constructor(
        private readonly pg: PgPoolService,
        private readonly orgs: OrganizationContextService,
    ) { }

    private mapUserRow(row: DbUserRow): UserRow {
        const roles = Array.isArray(row.roles)
            ? row.roles
                  .map((r: any) => ({
                      id: String(r.id ?? ""),
                      name: String(r.name ?? "").trim(),
                  }))
                  .filter((r) => r.id && r.name)
            : [];

        const primaryRoleName = row.primary_role_name || roles[0]?.name || "";
        const displayNameParts = [row.first_name, row.last_name].map((v) => v?.trim()).filter(Boolean) as string[];
        const displayName = displayNameParts.length
            ? displayNameParts.join(" ")
            : row.email.split("@")[0];

        return {
            id: row.id,
            name: displayName,
            email: row.email,
            role: primaryRoleName,
            status: (row.status as UserRow["status"]) ?? "active",
            twoFactorEnabled: !!row.two_factor_enabled,
            suspended: row.status === "suspended",
            lastSeen: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
            roleId: row.primary_role_id,
            roles,
        };
    }

    private async ensureUserExists(userId: string): Promise<{ organization_id: string }> {
        const { rows } = await this.pg.query<{ organization_id: string }>(
            `SELECT organization_id FROM public.users WHERE id = $1 LIMIT 1`,
            [userId],
        );
        if (!rows[0]) {
            throw new NotFoundException("User not found");
        }
        return rows[0];
    }

    private async ensureUserSecurityRow(userId: string): Promise<void> {
        await this.pg.query(
            `INSERT INTO public.user_security (user_id)
             VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId],
        );
    }

    private async replaceUserRoles(userId: string, roleIds: string[]): Promise<void> {
        await this.pg.query(`DELETE FROM public.user_roles WHERE user_id = $1`, [userId]);
        if (!roleIds.length) return;
        const values = roleIds.map((_, idx) => `($1, $${idx + 2})`).join(", ");
        await this.pg.query(
            `INSERT INTO public.user_roles (user_id, role_id)
             VALUES ${values}`,
            [userId, ...roleIds],
        );
    }

    private async findDefaultRoleId(orgId: string): Promise<string | null> {
        const { rows } = await this.pg.query<{ id: string }>(
            `SELECT id
             FROM public.roles
             WHERE (scope = 'organization' AND organization_id = $1)
                OR scope = 'system'
             ORDER BY
                CASE LOWER(name)
                    WHEN 'owner' THEN 0
                    WHEN 'admin' THEN 1
                    WHEN 'administrator' THEN 2
                    WHEN 'technician' THEN 3
                    WHEN 'user' THEN 4
                    ELSE 10
                END,
                scope DESC,
                LOWER(name)
             LIMIT 1`,
            [orgId],
        );
        return rows[0]?.id ?? null;
    }

    private async resolveRoleId(orgId: string, input?: string | null): Promise<string | null> {
        const trimmed = input?.trim();
        if (trimmed) {
            if (isUuid(trimmed)) {
                const { rows } = await this.pg.query<{ id: string }>(
                    `SELECT id
                     FROM public.roles
                     WHERE id = $1 AND ((scope = 'organization' AND organization_id = $2) OR scope = 'system')
                     LIMIT 1`,
                    [trimmed, orgId],
                );
                if (rows[0]?.id) return rows[0].id;
            } else {
                const { rows } = await this.pg.query<{ id: string }>(
                    `SELECT id
                     FROM public.roles
                     WHERE LOWER(name) = LOWER($2)
                       AND ((scope = 'organization' AND organization_id = $1) OR scope = 'system')
                     ORDER BY scope DESC
                     LIMIT 1`,
                    [orgId, trimmed],
                );
                if (rows[0]?.id) return rows[0].id;
            }
        }

        // Attempt to fall back to a sensible default ("User" etc.)
        for (const candidate of DEFAULT_ROLE_CANDIDATES) {
            const { rows } = await this.pg.query<{ id: string }>(
                `SELECT id
                 FROM public.roles
                 WHERE LOWER(name) = $2
                   AND ((scope = 'organization' AND organization_id = $1) OR scope = 'system')
                 ORDER BY scope DESC
                 LIMIT 1`,
                [orgId, candidate],
            );
            if (rows[0]?.id) return rows[0].id;
        }

        return null;
    }

    private buildSearchClause(params: any[], value?: string | null): string | null {
        const term = value?.trim();
        if (!term) return null;
        params.push(`%${term.toLowerCase()}%`);
        const idx = params.length;
        return `(
            LOWER(u.email) LIKE $${idx}
            OR LOWER(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) LIKE $${idx}
        )`;
    }

    async list(q: ListUsersQuery): Promise<{ items: UserRow[]; total: number }> {
        const orgId = await this.orgs.getDefaultOrganizationId();
        const params: any[] = [orgId];
        const where: string[] = [`u.organization_id = $1`];

        const search = this.buildSearchClause(params, q.q);
        if (search) where.push(search);

        if (q.status && q.status !== "all") {
            params.push(q.status);
            where.push(`u.status = $${params.length}`);
        }

        if (q.role && q.role !== "all") {
            params.push(q.role);
            const idx = params.length;
            const clause = isUuid(q.role)
                ? `EXISTS (
                        SELECT 1
                        FROM public.user_roles urf
                        WHERE urf.user_id = u.id AND urf.role_id = $${idx}
                    )`
                : `EXISTS (
                        SELECT 1
                        FROM public.user_roles urf
                        JOIN public.roles rf ON rf.id = urf.role_id
                        WHERE urf.user_id = u.id AND LOWER(rf.name) = LOWER($${idx})
                    )`;
            where.push(clause);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const countSql = `SELECT COUNT(*)::int AS c FROM public.users u ${whereSql}`;
        const { rows: countRows } = await this.pg.query<{ c: number }>(countSql, params);
        const total = countRows[0]?.c ?? 0;

        const sortKeyMap: Record<string, string> = {
            name: "display_name",
            email: "LOWER(u.email)",
            role: "LOWER(COALESCE(pr.name, ''))",
            lastSeen: "u.last_seen_at",
        };
        const sortKey = sortKeyMap[q.sortKey ?? "name"] || sortKeyMap.name;
        const sortDir = q.sortDir?.toUpperCase() === "DESC" ? "DESC" : "ASC";

        const page = Math.max(1, q.page ?? 1);
        const pageSize = Math.max(1, q.pageSize ?? 25);
        const offset = (page - 1) * pageSize;

        const dataSql = `
            SELECT
                u.id,
                u.email,
                u.first_name,
                u.last_name,
                u.status,
                u.last_seen_at,
                u.created_at,
                u.updated_at,
                COALESCE(us.two_factor_enabled, false) AS two_factor_enabled,
                pr.id AS primary_role_id,
                pr.name AS primary_role_name,
                COALESCE(
                    jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'name', r.name))
                    FILTER (WHERE r.id IS NOT NULL),
                    '[]'::jsonb
                ) AS roles,
                COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(u.first_name, ''), NULLIF(u.last_name, '')), ''), u.email) AS display_name
            FROM public.users u
            LEFT JOIN public.user_security us ON us.user_id = u.id
            LEFT JOIN public.user_roles ur ON ur.user_id = u.id
            LEFT JOIN public.roles r ON r.id = ur.role_id
            LEFT JOIN LATERAL (
                SELECT r2.id, r2.name
                FROM public.user_roles ur2
                JOIN public.roles r2 ON r2.id = ur2.role_id
                WHERE ur2.user_id = u.id
                ORDER BY r2.scope DESC, LOWER(r2.name) ASC
                LIMIT 1
            ) pr ON TRUE
            ${whereSql}
            GROUP BY u.id, us.two_factor_enabled, pr.id, pr.name
            ORDER BY ${sortKey} ${sortDir}, display_name ASC
            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}
        `;

        const { rows } = await this.pg.query<DbUserRow>(dataSql, [...params, pageSize, offset]);
        return {
            items: rows.map((row) => this.mapUserRow(row)),
            total,
        };
    }

    async roles(): Promise<{ id: string; name: string }[]> {
        const orgId = await this.orgs.getDefaultOrganizationId();
        const { rows } = await this.pg.query(
            `SELECT id, name
             FROM public.roles
             WHERE scope = 'system' OR organization_id = $1
             ORDER BY scope DESC, LOWER(name) ASC`,
            [orgId],
        );
        return rows.map((r: any) => ({ id: r.id, name: r.name }));
    }

    async inviteOne(dto: InviteUserDto): Promise<{ id: string }> {
        const orgId = await this.orgs.getDefaultOrganizationId();
        const email = dto.email.toLowerCase().trim();
        const fallbackName = email.split("@")[0];
        const displayName = coalesceString(dto.name) || fallbackName;
        const { first, last } = splitDisplayName(displayName);
        const passwordHash = await bcrypt.hash(randomUUID(), SALT_ROUNDS);
        const roleId = await this.resolveRoleId(orgId, dto.role);

        const { rows } = await this.pg.query<{ id: string }>(
            `INSERT INTO public.users (organization_id, email, password_hash, first_name, last_name, status)
             VALUES ($1, $2, $3, $4, $5, 'invited')
             ON CONFLICT (organization_id, email) DO UPDATE
               SET first_name = EXCLUDED.first_name,
                   last_name = EXCLUDED.last_name,
                   status = 'invited'
             RETURNING id`,
            [orgId, email, passwordHash, first, last],
        );

        const id = rows[0]?.id;
        if (!id) return { id: "" };

        await this.ensureUserSecurityRow(id);
        if (roleId) await this.replaceUserRoles(id, [roleId]);

        return { id };
    }

    async inviteBulk(dto: BulkInviteDto): Promise<{ created: number }> {
        let created = 0;
        for (const inv of dto.invites || []) {
            const res = await this.inviteOne(inv);
            if (res.id) created++;
        }
        return { created };
    }

    async updateRole(id: string, dto: UpdateRoleDto): Promise<void> {
        const user = await this.ensureUserExists(id);
        const roleId = await this.resolveRoleId(user.organization_id, dto.role);
        if (!roleId) {
            await this.replaceUserRoles(id, []);
            return;
        }
        await this.replaceUserRoles(id, [roleId]);
    }

    async setSuspended(id: string, suspended: boolean): Promise<void> {
        await this.ensureUserExists(id);
        const status = suspended ? "suspended" : "active";
        const { rowCount } = await this.pg.query(
            `UPDATE public.users
             SET status = $2,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, status],
        );
        if (rowCount === 0) throw new NotFoundException("User not found");
    }

    async reset2fa(id: string): Promise<void> {
        await this.ensureUserExists(id);
        const { rowCount } = await this.pg.query(
            `INSERT INTO public.user_security (user_id, two_factor_enabled, totp_secret, recovery_codes)
             VALUES ($1, false, NULL, '{}'::text[])
             ON CONFLICT (user_id) DO UPDATE
               SET two_factor_enabled = false,
                   totp_secret = NULL,
                   recovery_codes = '{}'::text[]`,
            [id],
        );
        if (rowCount === 0) throw new NotFoundException("User not found");
    }

    async remove(id: string): Promise<void> {
        const { rowCount } = await this.pg.query(`DELETE FROM public.users WHERE id = $1`, [id]);
        if (rowCount === 0) throw new NotFoundException("User not found");
    }

    async createOne(dto: CreateUserDto): Promise<{ id: string }> {
        const orgId = await this.orgs.getDefaultOrganizationId();
        const email = dto.email.toLowerCase().trim();
        const status = dto.status ?? "active";
        if (!["active", "invited", "suspended"].includes(status)) {
            throw new BadRequestException("Invalid status");
        }

        const displayName = coalesceString(dto.name) || email.split("@")[0];
        const { first, last } = splitDisplayName(displayName);
        const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
        const roleId = await this.resolveRoleId(orgId, dto.role);

        const { rows } = await this.pg.query<{ id: string }>(
            `INSERT INTO public.users (organization_id, email, password_hash, first_name, last_name, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (organization_id, email) DO UPDATE
               SET first_name = EXCLUDED.first_name,
                   last_name = EXCLUDED.last_name,
                   status = EXCLUDED.status,
                   password_hash = EXCLUDED.password_hash,
                   updated_at = NOW()
             RETURNING id`,
            [orgId, email, passwordHash, first, last, status],
        );

        const id = rows[0]?.id;
        if (!id) {
            throw new ConflictException("Unable to create user");
        }

        await this.ensureUserSecurityRow(id);
        await this.pg.query(
            `UPDATE public.user_security
             SET password_changed_at = NOW()
             WHERE user_id = $1`,
            [id],
        );

        if (roleId) await this.replaceUserRoles(id, [roleId]);

        return { id };
    }

    async setPassword(id: string, body: ResetPasswordDto): Promise<void> {
        await this.ensureUserExists(id);
        const hash = await bcrypt.hash(body.password, SALT_ROUNDS);
        const { rowCount } = await this.pg.query(
            `UPDATE public.users
             SET password_hash = $2,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, hash],
        );
        if (rowCount === 0) throw new NotFoundException("User not found");

        await this.pg.query(
            `INSERT INTO public.user_security (user_id, password_changed_at)
             VALUES ($1, NOW())
             ON CONFLICT (user_id) DO UPDATE
               SET password_changed_at = EXCLUDED.password_changed_at`,
            [id],
        );
    }

    private async getUserColumns(): Promise<Set<string>> {
        const { rows } = await this.pg.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users'`,
        );
        return new Set(rows.map((r: any) => r.column_name));
    }

    async updateUser(id: string, dto: UpdateUserDto): Promise<void> {
        await this.ensureUserExists(id);
        const cols = await this.getUserColumns();
        const params: any[] = [id];
        const sets: string[] = [];

        if (dto.role !== undefined) {
            await this.updateRole(id, { role: dto.role });
        }

        if (dto.name !== undefined) {
            const { first, last } = splitDisplayName(dto.name);
            if (cols.has("first_name")) {
                params.push(first);
                sets.push(`first_name = $${params.length}`);
            }
            if (cols.has("last_name")) {
                params.push(last);
                sets.push(`last_name = $${params.length}`);
            }
        }

        if (dto.email !== undefined) {
            params.push(dto.email.trim().toLowerCase());
            sets.push(`email = $${params.length}`);
        }

        const optionalMap: Record<string, string> = {
            phone: "phone",
            address1: "address1",
            address2: "address2",
            city: "city",
            state: "state",
            postal: "postal",
            country: "country",
            avatarUrl: "avatar_url",
            avatarThumbUrl: "avatar_thumb_url",
        };

        for (const [key, column] of Object.entries(optionalMap)) {
            const value = (dto as any)[key];
            if (value !== undefined && cols.has(column)) {
                params.push(value);
                sets.push(`${column} = $${params.length}`);
            }
        }

        if (sets.length === 0) {
            return;
        }

        params.push(new Date());
        sets.push(`updated_at = $${params.length}`);

        const sql = `
            UPDATE public.users
            SET ${sets.join(", ")}
            WHERE id = $1
            RETURNING id
        `;
        const { rows } = await this.pg.query(sql, params);
        if (!rows[0]) throw new NotFoundException("User not found");
    }
}
