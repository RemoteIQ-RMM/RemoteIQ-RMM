
# RemoteIQ — Profile vs Admin User Edit (focused file dump)

Generated: 2025-11-06 22:55:00
Backend root:  C:\Users\Last Stop\Documents\Programming Projects\RemoteIQ V7 - Ticketing\remoteiq-minimal-e2e\backend
Frontend root: C:\Users\Last Stop\Documents\Programming Projects\RemoteIQ V7 - Ticketing\remoteiq-frontend

## Backend core files


### File: backend\src\users\me.controller.ts

```ts
//backend\src\users\me.controller.ts

import {
    Controller,
    Get,
    Patch,
    Body,
    UseInterceptors,
    UploadedFile,
    Post,
    Delete,
    Req,
    BadRequestException,
    UnauthorizedException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import type { Request } from "express";
import { MeService } from "./me.service";

/* ----------------------------- MIME → EXT map ----------------------------- */
const EXT_BY_MIME: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
};

/* ----------------------------- Rate limit (simple) ----------------------------- */
/** Allow one upload per user every 5 seconds (in-memory, per-instance). */
const UPLOAD_RATE_MS = 5_000;
const lastUploadByUser = new Map<string, number>();

/* ----------------------------- Multer callbacks ----------------------------- */
/** filename: (req, file, cb: (err: Error|null, filename: string) => void) => void */
function filenameCb(
    _req: any,
    file: Express.Multer.File,
    callback: (error: Error | null, filename: string) => void,
) {
    // derive extension from mime for consistency and safety
    const ext = EXT_BY_MIME[file.mimetype] ?? ".bin";
    // remove suspicious chars from provided name (if we keep it), and trim to avoid gigantic filenames
    const base =
        (file.originalname || "upload")
            .replace(/[^\w.\-]+/g, "_")
            .replace(/\.[A-Za-z0-9]+$/, "") // strip user-provided extension
            .slice(0, 80) || "upload";
    const safe = `${Date.now()}_${base}${ext}`;
    callback(null, safe);
}

/** fileFilter: (req, file, cb: (err: Error|null, accept: boolean) => void) => void */
function imageFilter(
    _req: any,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
) {
    const ok = !!EXT_BY_MIME[file.mimetype];
    if (!ok) return callback(new BadRequestException("Unsupported file type"), false);
    return callback(null, true);
}

/* ----------------------------- URL Builder ----------------------------- */
/**
 * Build an ABSOLUTE URL to the static mount that always works and never double-prefixes.
 * Rules:
 * - If PUBLIC_BASE_URL is set, use it as the host origin (no trailing slash).
 * - Otherwise derive protocol/host from the request.
 * - Ensure exactly one '/static' segment before '/uploads/...'.
 *
 * Examples that all yield a single '/static/uploads/...':
 *   PUBLIC_BASE_URL=http://localhost:3001         -> http://localhost:3001/static/uploads/<file>
 *   PUBLIC_BASE_URL=http://localhost:3001/static  -> http://localhost:3001/static/uploads/<file>
 *   PUBLIC_BASE_URL not set                       -> http(s)://<req host>/static/uploads/<file>
 */
function buildStaticUploadUrl(req: Request, filename: string): string {
    const raw = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""); // strip trailing '/'
    let origin: string;
    if (raw) {
        // If the env already ends with '/static', keep it; else append '/static'
        const staticBase = raw.endsWith("/static") ? raw : `${raw}/static`;
        origin = staticBase;
    } else {
        // derive from request
        const proto =
            (req.headers["x-forwarded-proto"] as string) ||
            (req.protocol || "http");
        const host = req.get("host") || "localhost:3001";
        origin = `${proto}://${host}/static`;
    }
    return `${origin}/uploads/${encodeURIComponent(filename)}`;
}

@Controller("/api/users")
export class MeController {
    constructor(private readonly me: MeService) { }

    // Current user profile
    @Get("me")
    async getMe(@Req() req: any) {
        const userId = req.user?.id; // set by your cookie middleware
        if (!userId) throw new UnauthorizedException("Not authenticated");
        return this.me.getMe(userId);
    }

    // Partial update
    @Patch("me")
    async patchMe(@Req() req: any, @Body() body: any) {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedException("Not authenticated");
        return this.me.updateMe(userId, body);
    }

    // Upload avatar (multipart/form-data; field name: "file")
    @Post("me/avatar")
    @UseInterceptors(
        FileInterceptor("file", {
            storage: diskStorage({
                destination: "public/uploads",
                filename: filenameCb,
            }),
            limits: {
                fileSize: Math.max(
                    1,
                    (Number(process.env.AVATAR_MAX_MB) || 5) * 1024 * 1024,
                ), // default 5 MB
            },
            fileFilter: imageFilter,
        }),
    )
    async uploadAvatar(@Req() req: Request & { user?: any }, @UploadedFile() file: Express.Multer.File) {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedException("Not authenticated");
        if (!file) throw new BadRequestException("No file uploaded");

        // rate-limit: N ms between uploads per user
        const now = Date.now();
        const last = lastUploadByUser.get(userId) || 0;
        if (now - last < UPLOAD_RATE_MS) {
            throw new BadRequestException("You're uploading too fast. Please wait a moment and try again.");
        }
        lastUploadByUser.set(userId, now);

        // Build a correct, absolute URL that points to ServeStatic '/static'
        const url = buildStaticUploadUrl(req, file.filename);

        // Save in DB; also sets avatar_thumb_url (same as main for now) and deletes previous local file if any
        await this.me.replaceAvatarUrl(userId, url);

        return { url };
    }

    // Remove avatar
    @Delete("me/avatar")
    async deleteAvatar(@Req() req: any) {
        const userId = req.user?.id;
        if (!userId) throw new UnauthorizedException("Not authenticated");

        await this.me.replaceAvatarUrl(userId, null);
        return { ok: true };
    }
}

```


### File: backend\src\users\me.service.ts

```ts
import { Injectable } from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import * as fs from "fs/promises";
import * as path from "path";

@Injectable()
export class MeService {
    constructor(private readonly pg: PgPoolService) { }

    // Compose a public URL for files served from /public (not used by controller anymore, but kept for compatibility)
    makePublicUrl(filename: string) {
        const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
        const staticBase = base ? (base.endsWith("/static") ? base : `${base}/static`) : "";
        return staticBase ? `${staticBase}/uploads/${filename}` : `/static/uploads/${filename}`;
    }

    /* ------------------------------ Helpers for local file cleanup ------------------------------ */

    /** Extract a local filesystem path for files under `/static/uploads/<name>` or `/uploads/<name>` */
    private toLocalUploadPathFromUrl(url?: string | null): string | null {
        if (!url) return null;
        let pathname = "";
        try {
            // absolute http(s) url
            const u = new URL(url);
            pathname = u.pathname;
        } catch {
            // not a full URL; treat as pathname-like
            pathname = url;
        }

        // Normalize where '/uploads/...' might appear (with or without /static prefix)
        const idx = pathname.indexOf("/uploads/");
        if (idx === -1) return null;

        const filename = pathname.substring(idx + "/uploads/".length);
        if (!filename || filename.includes("..")) return null;

        // Resolve to <project>/public/uploads/<filename>
        const uploadsDir = path.join(__dirname, "..", "public", "uploads");
        const abs = path.join(uploadsDir, filename);

        // Ensure file stays inside uploads dir (avoid traversal)
        const normUploads = path.normalize(uploadsDir + path.sep);
        const normFile = path.normalize(abs);
        if (!normFile.startsWith(normUploads)) return null;

        return normFile;
    }

    private async tryDeleteLocalFile(filePath: string | null) {
        if (!filePath) return;
        try {
            await fs.unlink(filePath);
        } catch {
            // swallow (file may not exist or we lack perms; not fatal)
        }
    }

    /* ------------------------------------ Profile CRUD ------------------------------------ */

    async getMe(userId: string) {
        const q = `
      select id, name, email,
             coalesce(phone, '') as phone,
             coalesce(timezone, '') as timezone,
             coalesce(locale, '') as locale,
             coalesce(avatar_url, '') as "avatarUrl",
             coalesce(avatar_thumb_url, '') as "avatarThumbUrl",
             coalesce(address1, '') as address1,
             coalesce(address2, '') as address2,
             coalesce(city, '') as city,
             coalesce(state, '') as state,
             coalesce(postal, '') as postal,
             coalesce(country, '') as country
      from users
      where id = $1
      limit 1
    `;
        const { rows } = await this.pg.query(q, [userId]);
        return rows[0] || {};
    }

    async updateMe(userId: string, patch: Record<string, any>) {
        // Only accept known columns; convert avatarUrl -> avatar_url
        const map: Record<string, string> = {
            name: "name",
            email: "email",
            phone: "phone",
            timezone: "timezone",
            locale: "locale",
            avatarUrl: "avatar_url",
            address1: "address1",
            address2: "address2",
            city: "city",
            state: "state",
            postal: "postal",
            country: "country",
        };

        const sets: string[] = [];
        const vals: any[] = [];
        let i = 1;

        for (const [k, v] of Object.entries(patch || {})) {
            const col = map[k];
            if (!col) continue;
            sets.push(`${col} = $${i++}`);
            vals.push(v);
            // keep thumb in sync if avatarUrl is set directly through PATCH
            if (col === "avatar_url") {
                sets.push(`avatar_thumb_url = $${i++}`);
                vals.push(v);
            }
        }
        if (sets.length === 0) {
            return this.getMe(userId);
        }
        vals.push(userId);

        const sql = `update users set ${sets.join(", ")}, updated_at = now() where id = $${i} returning id`;
        await this.pg.query(sql, vals);
        return this.getMe(userId);
    }

    /**
     * Replace avatar URLs and delete the previous local file (if any and if it was under /uploads).
     * If `nextUrl` is null, clears both avatar fields and removes old local file.
     */
    async replaceAvatarUrl(userId: string, nextUrl: string | null) {
        // first, read previous urls
        const { rows: prevRows } = await this.pg.query<{ avatar_url: string | null; avatar_thumb_url: string | null }>(
            `select avatar_url, avatar_thumb_url from users where id = $1 limit 1`,
            [userId],
        );
        const prev = prevRows[0] || { avatar_url: null, avatar_thumb_url: null };

        // upsert new URL(s); for now thumb mirrors the main url
        await this.pg.query(
            `update users
         set avatar_url = $2,
             avatar_thumb_url = $3,
             updated_at = now()
       where id = $1`,
            [userId, nextUrl, nextUrl],
        );

        // delete the previous local file if it lived under /uploads and is different than new
        const oldUrl = prev.avatar_url;
        if (oldUrl && oldUrl !== nextUrl) {
            const localPath = this.toLocalUploadPathFromUrl(oldUrl);
            await this.tryDeleteLocalFile(localPath);
        }

        // return updated profile
        return this.getMe(userId);
    }

    /** Kept for compatibility with earlier calls; now delegates to replaceAvatarUrl */
    async setAvatarUrl(userId: string, url: string | null) {
        return this.replaceAvatarUrl(userId, url);
    }
}

```


### File: backend\src\users\me.dto.ts

```ts
// backend/src/users/me.dto.ts
import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Partial update of the current user's profile.
 * Only provided fields are updated.
 */
export class UpdateMeDto {
    @IsOptional() @IsString() @MaxLength(120)
    name?: string;

    @IsOptional() @IsEmail()
    email?: string;

    @IsOptional() @IsString() @MaxLength(32)
    phone?: string;

    @IsOptional() @IsString() @MaxLength(64)
    timezone?: string;

    @IsOptional() @IsString() @MaxLength(16)
    locale?: string;

    // address block (all optional)
    @IsOptional() @IsString() @MaxLength(120)
    address1?: string;

    @IsOptional() @IsString() @MaxLength(120)
    address2?: string;

    @IsOptional() @IsString() @MaxLength(64)
    city?: string;

    @IsOptional() @IsString() @MaxLength(64)
    state?: string;

    @IsOptional() @IsString() @MaxLength(32)
    postal?: string;

    @IsOptional() @IsString() @MaxLength(64)
    country?: string;

    // avatar (normally set by upload API — left here for completeness)
    @IsOptional() @IsString() @MaxLength(512)
    avatarUrl?: string;

    @IsOptional() @IsString() @MaxLength(512)
    avatarThumbUrl?: string;
}

```


### File: backend\src\users\users.controller.ts

```ts
//backend/src/users/users.controller.ts

import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Patch,
    Post,
    Query,
    UsePipes,
    ValidationPipe,
} from "@nestjs/common";
import {
    BulkInviteDto,
    CreateUserDto,
    IdParam,
    InviteUserDto,
    ListUsersQuery,
    ResetPasswordDto,
    SuspendDto,
    UpdateRoleDto,
    UpdateUserDto,
} from "./users.dto";
import { UsersService } from "./users.service";

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller("/api/admin/users")
export class UsersController {
    constructor(private readonly svc: UsersService) { }

    @Get()
    async list(@Query() q: ListUsersQuery) {
        return this.svc.list(q);
    }

    // NEW: fetch a single user with full profile fields for the Admin Edit form
    @Get(":id")
    async getOne(@Param() p: IdParam) {
        return this.svc.getOne(p.id);
    }

    @Get("roles")
    async roles() {
        return this.svc.roles();
    }

    @Post("invite")
    async invite(@Body() body: InviteUserDto) {
        return this.svc.inviteOne(body);
    }

    @Post("invite/bulk")
    async inviteBulk(@Body() body: BulkInviteDto) {
        return this.svc.inviteBulk(body);
    }

    @Post("create")
    async create(@Body() body: CreateUserDto) {
        return this.svc.createOne(body);
    }

    @Patch(":id/role")
    @HttpCode(204)
    async updateRole(@Param() p: IdParam, @Body() body: UpdateRoleDto) {
        await this.svc.updateRole(p.id, body);
    }

    @Patch(":id")
    @HttpCode(204)
    async updateUser(@Param() p: IdParam, @Body() body: UpdateUserDto) {
        await this.svc.updateUser(p.id, body);
    }

    @Patch(":id/password")
    @HttpCode(204)
    async resetPasswordPatch(@Param() p: IdParam, @Body() body: ResetPasswordDto) {
        await this.svc.setPassword(p.id, body);
    }

    @Post(":id/password")
    @HttpCode(204)
    async resetPasswordPost(@Param() p: IdParam, @Body() body: ResetPasswordDto) {
        await this.svc.setPassword(p.id, body);
    }

    @Post(":id/reset-2fa")
    @HttpCode(204)
    async reset2fa(@Param() p: IdParam) {
        await this.svc.reset2fa(p.id);
    }

    @Post(":id/suspend")
    @HttpCode(204)
    async suspend(@Param() p: IdParam, @Body() body: SuspendDto) {
        await this.svc.setSuspended(p.id, body.suspended);
    }

    @Delete(":id")
    @HttpCode(204)
    async remove(@Param() p: IdParam) {
        await this.svc.remove(p.id);
    }
}

```


### File: backend\src\users\users.service.ts

```ts
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
    // extended profile fields (nullable)
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    state?: string | null;
    postal?: string | null;
    country?: string | null;
    avatar_url?: string | null;
    avatar_thumb_url?: string | null;
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
            roleId: row.primary_role_id,
            roles,
            status: (row.status as UserRow["status"]) ?? "active",
            twoFactorEnabled: !!row.two_factor_enabled,
            suspended: row.status === "suspended",
            lastSeen: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
            // include optional profile fields for Admin UI
            phone: row.phone ?? null,
            address1: row.address1 ?? null,
            address2: row.address2 ?? null,
            city: row.city ?? null,
            state: row.state ?? null,
            postal: row.postal ?? null,
            country: row.country ?? null,
            avatarUrl: row.avatar_url ?? null,
            avatarThumbUrl: row.avatar_thumb_url ?? null,
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

    // NEW: get a single user (with profile fields) for Admin Edit
    async getOne(id: string): Promise<UserRow> {
        const orgId = await this.orgs.getDefaultOrganizationId();
        const params: any[] = [orgId, id];

        const sql = `
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
                -- extended profile fields (nullable)
                u.phone,
                u.address1,
                u.address2,
                u.city,
                u.state,
                u.postal,
                u.country,
                u.avatar_url,
                u.avatar_thumb_url
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
            WHERE u.organization_id = $1 AND u.id = $2
            GROUP BY u.id, us.two_factor_enabled, pr.id, pr.name
            LIMIT 1
        `;

        const { rows } = await this.pg.query<DbUserRow>(sql, params);
        if (!rows[0]) throw new NotFoundException("User not found");
        return this.mapUserRow(rows[0]);
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
                COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(u.first_name, ''), NULLIF(u.last_name, '')), ''), u.email) AS display_name,
                -- extended profile fields (nullable) so Admin Edit can prefill even if UI uses list preload
                u.phone,
                u.address1,
                u.address2,
                u.city,
                u.state,
                u.postal,
                u.country,
                u.avatar_url,
                u.avatar_thumb_url
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

```


### File: backend\src\users\users.dto.ts

```ts
// backend/src/users/users.dto.ts
import {
    IsBoolean,
    IsEmail,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    MinLength,
} from "class-validator";
import { Type } from "class-transformer";

export type UserRoleSummary = { id: string; name: string };

export type UserRow = {
    id: string;
    name: string;
    email: string;
    role: string;
    roleId?: string | null;
    roles?: UserRoleSummary[];
    status: "active" | "suspended" | "invited";
    twoFactorEnabled: boolean;
    suspended?: boolean;
    lastSeen: string | null;
    createdAt: string;
    updatedAt: string;

    // Optional profile fields if present in DB (we don't require them)
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    state?: string | null;
    postal?: string | null;
    country?: string | null;

    // Avatars (nullable; map from avatar_url / avatar_thumb_url)
    avatarUrl?: string | null;
    avatarThumbUrl?: string | null;
};

export class ListUsersQuery {
    @IsOptional() @IsString() q?: string;
    @IsOptional() @IsString() role?: string;

    @IsOptional() @IsIn(["all", "active", "suspended", "invited"])
    status: "all" | "active" | "suspended" | "invited" = "all";

    @IsOptional() @IsIn(["name", "email", "role", "lastSeen"])
    sortKey: "name" | "email" | "role" | "lastSeen" = "name";

    @IsOptional() @IsIn(["asc", "desc"])
    sortDir: "asc" | "desc" = "asc";

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    page: number = 1;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    pageSize: number = 25;
}

export class InviteUserDto {
    @IsOptional() @IsString() name?: string;
    @IsEmail() email!: string;
    @IsOptional() @IsString() role?: string;
    @IsOptional() @IsString() message?: string;
}

export class BulkInviteDto {
    invites!: InviteUserDto[];
}

export class UpdateRoleDto {
    @IsString() role!: string;
}

export class IdParam {
    @IsUUID() id!: string;
}

export class SuspendDto {
    @IsBoolean() suspended!: boolean;
}

/* -------- Admin create + reset password -------- */
export class CreateUserDto {
    @IsString() @MinLength(1) name!: string;
    @IsEmail() email!: string;
    @IsOptional() @IsString() role?: string; // default "User"
    @IsString() @MinLength(8) password!: string;
    @IsOptional() @IsIn(["active", "invited", "suspended"])
    status?: "active" | "invited" | "suspended"; // default "active"
}

export class ResetPasswordDto {
    @IsString() @MinLength(8) password!: string;
}

/* -------- Update user details (only updates provided fields) -------- */
export class UpdateUserDto {
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsEmail() email?: string;
    @IsOptional() @IsString() role?: string;

    // Optional profile fields — updated only if present in DB
    @IsOptional() @IsString() phone?: string;
    @IsOptional() @IsString() address1?: string;
    @IsOptional() @IsString() address2?: string;
    @IsOptional() @IsString() city?: string;
    @IsOptional() @IsString() state?: string;
    @IsOptional() @IsString() postal?: string;
    @IsOptional() @IsString() country?: string;

    // If you decide to allow admin to set avatars here, keep these optional.
    @IsOptional() @IsString() avatarUrl?: string | null;
    @IsOptional() @IsString() avatarThumbUrl?: string | null;
}

/* ============================
   SELF PROFILE (current user)
   ============================ */

export class MeProfileDto {
    id!: string;
    name!: string;
    email!: string;

    @IsOptional() @IsString() phone?: string | null;
    @IsOptional() @IsString() timezone?: string | null;
    @IsOptional() @IsString() locale?: string | null;

    // Full-size avatar URL
    @IsOptional() @IsString() avatarUrl?: string | null;

    // Optional thumbnail URL if you generate/store one
    @IsOptional() @IsString() avatarThumbUrl?: string | null;

    // Address fields (kept optional for back-compat)
    @IsOptional() @IsString() address1?: string | null;
    @IsOptional() @IsString() address2?: string | null;
    @IsOptional() @IsString() city?: string | null;
    @IsOptional() @IsString() state?: string | null;
    @IsOptional() @IsString() postal?: string | null;
    @IsOptional() @IsString() country?: string | null;
}

export class UpdateMeDto {
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsEmail() email?: string;
    @IsOptional() @IsString() phone?: string | null;
    @IsOptional() @IsString() timezone?: string | null;
    @IsOptional() @IsString() locale?: string | null;

    @IsOptional() @IsString() avatarUrl?: string | null;
    @IsOptional() @IsString() avatarThumbUrl?: string | null;

    @IsOptional() @IsString() address1?: string | null;
    @IsOptional() @IsString() address2?: string | null;
    @IsOptional() @IsString() city?: string | null;
    @IsOptional() @IsString() state?: string | null;
    @IsOptional() @IsString() postal?: string | null;
    @IsOptional() @IsString() country?: string | null;
}

```


### File: backend\src\storage\pg-pool.service.ts

```ts
//backend\src\storage\pg-pool.service.ts

import { Injectable, OnModuleDestroy } from "@nestjs/common";

// We use require() + loose typing to avoid the “Cannot use namespace … as a type” errors
// that can happen in some TS configs when importing from 'pg'.
const { Pool } = require("pg") as { Pool: any };

export type PgRuntimeConfig = {
    connectionString?: string;
    ssl?: boolean | object;
    max?: number;
    min?: number;
};

@Injectable()
export class PgPoolService implements OnModuleDestroy {
    private pool: any = null;
    private lastKey: string | null = null;

    /** Build a default config from env (used on first access if not configured) */
    private envConfig(): PgRuntimeConfig {
        const url =
            process.env.DATABASE_URL ||
            process.env.PG_URL ||
            "postgres://remoteiq:remoteiqpass@localhost:5432/remoteiq";

        const ssl =
            (process.env.DATABASE_SSL ?? "").toLowerCase() === "true" ? true : false;

        const max = Number.isFinite(+process.env.DATABASE_POOL_MAX!)
            ? Number(process.env.DATABASE_POOL_MAX)
            : 10;
        const min = Number.isFinite(+process.env.DATABASE_POOL_MIN!)
            ? Number(process.env.DATABASE_POOL_MIN)
            : 0;

        return { connectionString: url, ssl, max, min };
    }

    /** Create a stable key for the current config so we can know when to recreate the pool */
    private keyOf(cfg: PgRuntimeConfig): string {
        return JSON.stringify({
            cs: cfg.connectionString ?? "",
            ssl: cfg.ssl ? "1" : "0",
            max: cfg.max ?? 10,
            min: cfg.min ?? 0,
        });
    }

    private makePool(cfg: PgRuntimeConfig): any {
        const base: any = {
            connectionString: cfg.connectionString,
            max: cfg.max ?? 10,
            min: cfg.min ?? 0,
        };
        if (cfg.ssl) {
            base.ssl = cfg.ssl === true ? { rejectUnauthorized: false } : cfg.ssl;
        }
        return new Pool(base);
    }

    /** Ensure pool exists; create from env if needed */
    private ensurePool(): any {
        if (!this.pool) {
            const cfg = this.envConfig();
            this.lastKey = this.keyOf(cfg);
            this.pool = this.makePool(cfg);
        }
        return this.pool!;
    }

    /**
     * Called by admin bootstrap when the database config changes.
     * Recreates the pool if the effective config differs.
     */
    configure(cfg: PgRuntimeConfig) {
        const nextKey = this.keyOf(cfg);
        if (this.pool && this.lastKey === nextKey) return; // no-op

        // tear down previous pool
        if (this.pool) {
            try {
                this.pool.end().catch(() => { });
            } catch { }
            this.pool = null;
        }

        this.pool = this.makePool(cfg);
        this.lastKey = nextKey;
    }

    async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
        const res = await this.ensurePool().query(text, params);
        return { rows: res.rows as T[], rowCount: typeof res.rowCount === "number" ? res.rowCount : 0 };
    }

    async onModuleDestroy() {
        if (this.pool) {
            try {
                await this.pool.end();
            } catch { }
            this.pool = null;
        }
    }
}

```


## Backend migrations touching public.users


### File: backend\migrations\001_users_passwords.sql

```sql
-- Adds password fields to users for admin-created users & manual resets
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE
    users
ADD
    COLUMN IF NOT EXISTS password_hash text,
ADD
    COLUMN IF NOT EXISTS password_updated_at timestamptz;

-- (Optional) if you want invited users to be default 'invited' not 'active'
ALTER TABLE
    users
ALTER COLUMN
    status
SET
    DEFAULT 'active';
```


### File: backend\migrations\20251019_keep_current_model.sql

```sql
/*
 KEEP CURRENT MODEL (users.role is TEXT)
 
 This migration:
 - Ensures pgcrypto is available (for gen_random_uuid if you ever need it)
 - Enhances roles table (description, permissions text[], updated_at)
 - Adds case-insensitive unique index on roles.name
 - Adds a generic "updated_at" trigger and enables it for tables that already have an updated_at column
 (roles, users, support_legal_settings, branding_settings)
 - Adds a helpful index on lower(users.role) for faster role counts
 - Seeds Owner/Admin/User roles if missing (safe, idempotent)
 - Creates roles_with_counts view (used by API to return usersCount)
 */
-- 0) Extension (safe / idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) ROLES: add columns if missing
DO $ $ BEGIN IF NOT EXISTS (
    SELECT
        1
    FROM
        information_schema.columns
    WHERE
        table_schema = 'public'
        AND table_name = 'roles'
        AND column_name = 'description'
) THEN
ALTER TABLE
    public.roles
ADD
    COLUMN description text;

END IF;

IF NOT EXISTS (
    SELECT
        1
    FROM
        information_schema.columns
    WHERE
        table_schema = 'public'
        AND table_name = 'roles'
        AND column_name = 'permissions'
) THEN
ALTER TABLE
    public.roles
ADD
    COLUMN permissions text [] NOT NULL DEFAULT ARRAY [] :: text [];

END IF;

IF NOT EXISTS (
    SELECT
        1
    FROM
        information_schema.columns
    WHERE
        table_schema = 'public'
        AND table_name = 'roles'
        AND column_name = 'updated_at'
) THEN
ALTER TABLE
    public.roles
ADD
    COLUMN updated_at timestamptz NOT NULL DEFAULT now();

END IF;

END $ $;

-- 2) ROLES: case-insensitive uniqueness on name (keeps your existing unique on name too)
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_lower_key ON public.roles (lower(name));

-- 3) Generic updated_at trigger function (reused by several tables)
DO $ $ BEGIN IF NOT EXISTS (
    SELECT
        1
    FROM
        pg_proc
    WHERE
        proname = 'set_updated_at_now'
) THEN CREATE
OR REPLACE FUNCTION public.set_updated_at_now() RETURNS trigger LANGUAGE plpgsql AS $ fn $ BEGIN NEW.updated_at := now();

RETURN NEW;

END;

$ fn $;

END IF;

END $ $;

-- 4) Attach updated_at triggers for tables that already have updated_at
--    (safe: checks existence before creating)
DO $ $ BEGIN -- roles
IF EXISTS (
    SELECT
        1
    FROM
        information_schema.columns
    WHERE
        table_schema = 'public'
        AND table_name = 'roles'
        AND column_name = 'updated_at'
)
AND NOT EXISTS (
    SELECT
        1
    FROM
        pg_trigger
    WHERE
        tgname = 'trg_roles_set_updated_at'
) THEN CREATE TRIGGER trg_roles_set_updated_at BEFORE
UPDATE
    ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

END IF;

-- users
IF EXISTS (
    SELECT
        1
    FROM
        information_schema.columns
    WHERE
        table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'updated_at'
)
AND NOT EXISTS (
    SELECT
        1
    FROM
        pg_trigger
    WHERE
        tgname = 'trg_users_set_updated_at'
) THEN CREATE TRIGGER trg_users_set_updated_at BEFORE
UPDATE
    ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

END IF;

-- support_legal_settings
IF EXISTS (
    SELECT
        1
    FROM
        information_schema.columns
    WHERE
        table_schema = 'public'
        AND table_name = 'support_legal_settings'
        AND column_name = 'updated_at'
)
AND NOT EXISTS (
    SELECT
        1
    FROM
        pg_trigger
    WHERE
        tgname = 'trg_support_legal_settings_set_updated_at'
) THEN CREATE TRIGGER trg_support_legal_settings_set_updated_at BEFORE
UPDATE
    ON public.support_legal_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

END IF;

-- branding_settings
IF EXISTS (
    SELECT
        1
    FROM
        information_schema.columns
    WHERE
        table_schema = 'public'
        AND table_name = 'branding_settings'
        AND column_name = 'updated_at'
)
AND NOT EXISTS (
    SELECT
        1
    FROM
        pg_trigger
    WHERE
        tgname = 'trg_branding_settings_set_updated_at'
) THEN CREATE TRIGGER trg_branding_settings_set_updated_at BEFORE
UPDATE
    ON public.branding_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

END IF;

END $ $;

-- 5) Helpful performance index for role counts
CREATE INDEX IF NOT EXISTS idx_users_lower_role ON public.users (lower(role));

-- 6) Seed common roles if missing (safe/idempotent; keeps your current model)
INSERT INTO
    public.roles (name, description, permissions)
SELECT
    r.name,
    r.description,
    r.permissions
FROM
    (
        VALUES
            (
                'Owner',
                'System owner',
                ARRAY [
    'users.read','users.write','users.delete','users.2fa.reset',
    'roles.read','roles.write','roles.delete',
    'teams.read','teams.write','teams.delete',
    'billing.read','billing.write',
    'settings.read','settings.write'
  ] :: text []
            ),
            (
                'Admin',
                'Administrator',
                ARRAY [
    'users.read','users.write','users.2fa.reset',
    'roles.read','roles.write',
    'teams.read','teams.write',
    'billing.read',
    'settings.read','settings.write'
  ] :: text []
            ),
            (
                'User',
                'Standard user',
                ARRAY [
    'users.read','roles.read','teams.read','billing.read','settings.read'
  ] :: text []
            )
    ) AS r(name, description, permissions)
WHERE
    NOT EXISTS (
        SELECT
            1
        FROM
            public.roles x
        WHERE
            lower(x.name) = lower(r.name)
    );

-- 7) View that your API can read directly to provide usersCount in one call
CREATE
OR REPLACE VIEW public.roles_with_counts AS
SELECT
    ro.id,
    ro.name,
    ro.description,
    ro.permissions,
    ro.created_at,
    ro.updated_at,
    COALESCE(u.cnt, 0) :: int AS users_count
FROM
    public.roles ro
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*) AS cnt
        FROM
            public.users u
        WHERE
            lower(u.role) = lower(ro.name)
    ) u ON TRUE;
```


### File: backend\migrations\20251019_roles_companion_meta.sql

```sql
-- ======================================================================
-- roles companion metadata (non-breaking, keeps your current model)
--   - Adds role_meta table keyed to roles.name
--   - Stores description, permissions (text[]), updated_at
--   - Adds trigger to auto-bump updated_at on UPDATE
--   - Creates a convenience VIEW for listing with users_count
-- ======================================================================

BEGIN;

-- 1) role_meta table (companion to roles)
CREATE TABLE IF NOT EXISTS public.role_meta (
  role_name   text PRIMARY KEY,
  description text,
  permissions text[] NOT NULL DEFAULT '{}'::text[],
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_role_meta_role
    FOREIGN KEY (role_name)
    REFERENCES public.roles(name)
    ON DELETE CASCADE
);

-- 2) Update timestamp trigger for role_meta
CREATE OR REPLACE FUNCTION public.role_meta_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_meta_touch_updated_at ON public.role_meta;
CREATE TRIGGER trg_role_meta_touch_updated_at
BEFORE UPDATE ON public.role_meta
FOR EACH ROW
EXECUTE FUNCTION public.role_meta_touch_updated_at();

-- 3) Helpful index for case-insensitive joins/lookups (optional but handy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_indexes
    WHERE  schemaname = 'public'
      AND  indexname  = 'idx_role_meta_lower_name'
  ) THEN
    EXECUTE 'CREATE INDEX idx_role_meta_lower_name
             ON public.role_meta (lower(role_name))';
  END IF;
END;
$$;

-- 4) View that your API can SELECT from to satisfy the RolesTab shape
--    - users_count derived from users.role (TEXT) against role name
--    - updated_at prefers meta.updated_at else roles.created_at
CREATE OR REPLACE VIEW public.roles_with_meta AS
SELECT
  r.id,
  r.name,
  COALESCE(rm.description, '')           AS description,
  COALESCE(rm.permissions, '{}')         AS permissions,
  COALESCE(rm.updated_at, r.created_at)  AS updated_at,
  r.created_at,
  (
    SELECT COUNT(*)::int
    FROM public.users u
    WHERE lower(u.role) = lower(r.name)
  ) AS users_count
FROM public.roles r
LEFT JOIN public.role_meta rm
  ON rm.role_name = r.name;

-- 5) Seed role_meta rows for existing roles (no-op if already present)
INSERT INTO public.role_meta (role_name, description, permissions)
SELECT r.name,
       CASE lower(r.name)
         WHEN 'owner' THEN 'Full system access'
         WHEN 'admin' THEN 'Administrative access'
         ELSE 'Standard access'
       END,
       CASE lower(r.name)
         WHEN 'owner' THEN ARRAY[
           'users.read','users.write','users.delete','users.2fa.reset',
           'roles.read','roles.write','roles.delete',
           'teams.read','teams.write','teams.delete',
           'billing.read','billing.write',
           'settings.read','settings.write'
         ]::text[]
         WHEN 'admin' THEN ARRAY[
           'users.read','users.write','users.2fa.reset',
           'roles.read','roles.write',
           'teams.read','teams.write',
           'billing.read',
           'settings.read','settings.write'
         ]::text[]
         ELSE ARRAY['users.read','roles.read','teams.read','settings.read']::text[]
       END
FROM public.roles r
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_meta rm WHERE rm.role_name = r.name
);

COMMIT;

```


### File: backend\migrations\20251106_permissions_schema.sql

```sql
-- 20251106_permissions_schema.sql
-- Creates roles.description, permissions, and role_permissions (idempotent)

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Roles: add description column if missing
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS description text;

-- 2) Permissions master table
CREATE TABLE IF NOT EXISTS public.permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,         -- e.g. 'users.read'
  label       text NOT NULL,                -- human label
  group_key   text NOT NULL,                -- e.g. 'users'
  group_label text NOT NULL,                -- e.g. 'Users'
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Helpful indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='permissions_group_key_idx'
  ) THEN
    CREATE INDEX permissions_group_key_idx ON public.permissions (group_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='permissions_key_idx'
  ) THEN
    CREATE INDEX permissions_key_idx ON public.permissions (key);
  END IF;
END$$;

-- 3) Role ↔ Permission link table (composite PK)
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id       uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

COMMIT;

```


### File: backend\migrations\20251106_permissions_seed.sql

```sql
-- 20251106_permissions_seed.sql
-- Seeds standard permissions; ensures Owner/Admin roles and grants.
-- Safe to run multiple times.

BEGIN;

-- Helper upsert function for permissions
CREATE OR REPLACE FUNCTION public._upsert_permission(
  p_key text, p_label text, p_group_key text, p_group_label text
) RETURNS void AS $$
BEGIN
  INSERT INTO public.permissions (key, label, group_key, group_label)
  VALUES (p_key, p_label, p_group_key, p_group_label)
  ON CONFLICT (key) DO UPDATE
    SET label       = EXCLUDED.label,
        group_key   = EXCLUDED.group_key,
        group_label = EXCLUDED.group_label;
END
$$ LANGUAGE plpgsql;

-- ===== Users =====
SELECT public._upsert_permission('users.read',       'View users',         'users','Users');
SELECT public._upsert_permission('users.write',      'Create/edit users',  'users','Users');
SELECT public._upsert_permission('users.delete',     'Remove users',       'users','Users');
SELECT public._upsert_permission('users.2fa.reset',  'Reset 2FA',          'users','Users');

-- ===== Roles =====
SELECT public._upsert_permission('roles.read',   'roles.read',   'roles','Roles');
SELECT public._upsert_permission('roles.write',  'roles.write',  'roles','Roles');
SELECT public._upsert_permission('roles.delete', 'roles.delete', 'roles','Roles');

-- ===== Teams =====
SELECT public._upsert_permission('teams.read',   'teams.read',   'teams','Teams');
SELECT public._upsert_permission('teams.write',  'teams.write',  'teams','Teams');
SELECT public._upsert_permission('teams.delete', 'teams.delete', 'teams','Teams');

-- ===== Billing =====
SELECT public._upsert_permission('billing.read',  'billing.read',  'billing','Billing');
SELECT public._upsert_permission('billing.write', 'billing.write', 'billing','Billing');

-- ===== Settings =====
SELECT public._upsert_permission('settings.read',  'settings.read',  'settings','Settings');
SELECT public._upsert_permission('settings.write', 'settings.write', 'settings','Settings');

-- ===== Backups =====
SELECT public._upsert_permission('backups.manage',   'Manage backups (run/config)', 'backups','Backups');
SELECT public._upsert_permission('backups.restore',  'Restore from backups',        'backups','Backups');
SELECT public._upsert_permission('backups.download', 'Download backup artifacts',   'backups','Backups');

-- Cleanup helper
DROP FUNCTION IF EXISTS public._upsert_permission(text,text,text,text);

-- Ensure Owner/Admin roles exist (with descriptions)
INSERT INTO public.roles (id, name, description)
SELECT gen_random_uuid(), 'Owner', 'Full system access'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE lower(name)='owner');

INSERT INTO public.roles (id, name, description)
SELECT gen_random_uuid(), 'Admin', 'Administrative access'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE lower(name)='admin');

-- Grant Owner every permission
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE lower(r.name)='owner'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id=r.id AND rp.permission_id=p.id
  );

-- Grant Admin a curated set (edit as needed)
WITH admin_role AS (
  SELECT id FROM public.roles WHERE lower(name)='admin'
),
wanted AS (
  SELECT id FROM public.permissions WHERE key IN (
    'users.read','users.write','users.delete','users.2fa.reset',
    'roles.read','roles.write','roles.delete',
    'teams.read','teams.write','teams.delete',
    'billing.read','billing.write',
    'settings.read','settings.write',
    'backups.manage','backups.restore','backups.download'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ar.id, w.id
FROM admin_role ar
JOIN wanted w ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp
  WHERE rp.role_id = ar.id AND rp.permission_id = w.id
);

COMMIT;

```


### File: backend\migrations\XXXX_add_users_roles.sql

```sql
-- migrations/XXXX_add_users_roles.sql
-- Users & Roles schema (idempotent)
-- Needed for gen_random_uuid() in some Postgres setups
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------
-- roles
-- -----------------------------
CREATE TABLE IF NOT EXISTS roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text UNIQUE NOT NULL,
    description text
);

-- Seed common roles (no duplicates)
INSERT INTO
    roles (name, description)
VALUES
    (
        'Owner',
        'Full access to all organization settings and data'
    ),
    (
        'Admin',
        'Manage users, settings, billing; full device access'
    ),
    ('User', 'Standard access') ON CONFLICT (name) DO NOTHING;

-- -----------------------------
-- users
-- -----------------------------
CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    email text UNIQUE NOT NULL,
    role text NOT NULL DEFAULT 'User',
    status text NOT NULL DEFAULT 'active',
    -- 'active' | 'suspended'
    two_factor_enabled boolean NOT NULL DEFAULT false,
    last_seen timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

-- -----------------------------
-- updated_at trigger
-- -----------------------------
CREATE
OR REPLACE FUNCTION set_users_updated_at() RETURNS trigger LANGUAGE plpgsql AS $ func $ BEGIN NEW.updated_at := now();

RETURN NEW;

END $ func $;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;

CREATE TRIGGER trg_users_updated_at BEFORE
UPDATE
    ON users FOR EACH ROW EXECUTE FUNCTION set_users_updated_at();

-- -----------------------------
-- Optional: seed a demo user if you want (email must be unique).
-- Comment out if you don't want any seed user here.
-- -----------------------------
INSERT INTO
    users (name, email, role, status, two_factor_enabled)
SELECT
    'Demo User',
    'demo@example.com',
    'User',
    'active',
    false
WHERE
    NOT EXISTS (
        SELECT
            1
        FROM
            users
        WHERE
            email = 'demo@example.com'
    );
```


### File: backend\migrations\XXXX_roles_enhancements.sql

```sql
-- === Add missing columns on roles (idempotent) ===
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='roles' AND column_name='description'
  ) THEN
    ALTER TABLE public.roles ADD COLUMN description text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='roles' AND column_name='permissions'
  ) THEN
    -- string[] to match your frontend
    ALTER TABLE public.roles ADD COLUMN permissions text[] NOT NULL DEFAULT ARRAY[]::text[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='roles' AND column_name='updated_at'
  ) THEN
    ALTER TABLE public.roles ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END$$;

-- === Case-insensitive unique constraint on roles.name ===
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM   pg_indexes 
    WHERE  schemaname='public' AND tablename='roles' AND indexname='roles_name_lower_key'
  ) THEN
    CREATE UNIQUE INDEX roles_name_lower_key ON public.roles (lower(name));
  END IF;
END$$;

-- === Trigger to keep updated_at fresh ===
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'roles_set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION roles_set_updated_at()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $fn$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_roles_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_roles_set_updated_at
    BEFORE UPDATE ON public.roles
    FOR EACH ROW EXECUTE FUNCTION roles_set_updated_at();
  END IF;
END$$;

-- === (Optional) Seed common roles if missing ===
INSERT INTO public.roles (name, description, permissions)
SELECT r.name, r.description, r.permissions
FROM (VALUES
  ('Owner', 'System owner', ARRAY[
    'users.read','users.write','users.delete','users.2fa.reset',
    'roles.read','roles.write','roles.delete',
    'teams.read','teams.write','teams.delete',
    'billing.read','billing.write',
    'settings.read','settings.write'
  ]::text[]),
  ('Admin', 'Administrator', ARRAY[
    'users.read','users.write','users.2fa.reset',
    'roles.read','roles.write',
    'teams.read','teams.write',
    'billing.read',
    'settings.read','settings.write'
  ]::text[]),
  ('User', 'Standard user', ARRAY[
    'users.read','roles.read','teams.read','billing.read','settings.read'
  ]::text[])
) AS r(name, description, permissions)
WHERE NOT EXISTS (SELECT 1 FROM public.roles x WHERE lower(x.name)=lower(r.name));

-- === Convenience view for fast list with counts ===
CREATE OR REPLACE VIEW public.roles_with_counts AS
SELECT
  ro.id,
  ro.name,
  ro.description,
  ro.permissions,
  ro.created_at,
  ro.updated_at,
  COALESCE(u.cnt, 0)::int AS users_count
FROM public.roles ro
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS cnt
  FROM public.users u
  WHERE lower(u.role) = lower(ro.name)
) u ON TRUE;

```


### File: backend\migrations\XXXX_users_harden_ids.sql

```sql
-- Ensure pgcrypto (for gen_random_uuid) is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Normalize id to uuid (handle empty-string -> NULL), then set default
ALTER TABLE
    users
ALTER COLUMN
    id
SET
    DATA TYPE uuid USING NULLIF(id :: text, '') :: uuid;

ALTER TABLE
    users
ALTER COLUMN
    id
SET
    DEFAULT gen_random_uuid();

-- Add PRIMARY KEY on id if it doesn't already exist (no $$, no backslashes)
DO LANGUAGE plpgsql '
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = ''public.users''::regclass
    AND    contype  = ''p''
  ) THEN
    EXECUTE ''ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id)'';
  END IF;
END';

-- Add UNIQUE(email) if it doesn't already exist (no $$, no backslashes)
DO LANGUAGE plpgsql '
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = ''public.users''::regclass
    AND    contype  = ''u''
    AND    conname  = ''users_email_key''
  ) THEN
    EXECUTE ''ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)'';
  END IF;
END';

-- Backfill any NULL ids (should be rare after the USING cast)
UPDATE
    users
SET
    id = gen_random_uuid()
WHERE
    id IS NULL;
```


## Frontend Admin User Edit & Profile


## Quick references — phone/address/timezone/locale/avatar


### Matches: phone

```
- backend\src\company\company.dto.ts : line 8
- backend\src\company\company.service.ts : line 16
- backend\src\company\company.service.ts : line 30
- backend\src\company\company.service.ts : line 38
- backend\src\company\company.service.ts : line 53
- backend\src\support\support.dto.ts : line 10
- backend\src\support\support.service.ts : line 19
- backend\src\support\support.service.ts : line 33
- backend\src\support\support.service.ts : line 42
- backend\src\support\support.service.ts : line 52
- backend\src\support-legal\support-legal.dto.ts : line 5
- backend\src\support-legal\support-legal.dto.ts : line 17
- backend\src\support-legal\support-legal.service.ts : line 17
- backend\src\support-legal\support-legal.service.ts : line 25
- backend\src\support-legal\support-legal.service.ts : line 42
- backend\src\support-legal\support-legal.service.ts : line 44
- backend\src\support-legal\support-legal.service.ts : line 49
- backend\src\support-legal\support-legal.service.ts : line 57
- backend\src\support-legal\support-legal.service.ts : line 63
- backend\src\support-legal\support-legal.service.ts : line 71
- backend\src\users\me.dto.ts : line 16
- backend\src\users\me.service.ts : line 65
- backend\src\users\me.service.ts : line 89
- backend\src\users\users.dto.ts : line 32
- backend\src\users\users.dto.ts : line 109
- backend\src\users\users.dto.ts : line 131
- backend\src\users\users.dto.ts : line 153
- backend\src\users\users.service.ts : line 62
- backend\src\users\users.service.ts : line 110
- backend\src\users\users.service.ts : line 253
- backend\src\users\users.service.ts : line 354
- backend\src\users\users.service.ts : line 562
```


### Matches: address1

```
- backend\src\company\company.dto.ts : line 12
- backend\src\company\company.service.ts : line 18
- backend\src\company\company.service.ts : line 31
- backend\src\company\company.service.ts : line 42
- backend\src\company\company.service.ts : line 57
- backend\src\users\me.dto.ts : line 26
- backend\src\users\me.service.ts : line 70
- backend\src\users\me.service.ts : line 93
- backend\src\users\users.dto.ts : line 33
- backend\src\users\users.dto.ts : line 110
- backend\src\users\users.dto.ts : line 142
- backend\src\users\users.dto.ts : line 160
- backend\src\users\users.service.ts : line 63
- backend\src\users\users.service.ts : line 111
- backend\src\users\users.service.ts : line 254
- backend\src\users\users.service.ts : line 355
- backend\src\users\users.service.ts : line 563
```


### Matches: address2

```
- backend\src\company\company.dto.ts : line 13
- backend\src\company\company.service.ts : line 18
- backend\src\company\company.service.ts : line 31
- backend\src\company\company.service.ts : line 43
- backend\src\company\company.service.ts : line 58
- backend\src\users\me.dto.ts : line 29
- backend\src\users\me.service.ts : line 71
- backend\src\users\me.service.ts : line 94
- backend\src\users\users.dto.ts : line 34
- backend\src\users\users.dto.ts : line 111
- backend\src\users\users.dto.ts : line 143
- backend\src\users\users.dto.ts : line 161
- backend\src\users\users.service.ts : line 64
- backend\src\users\users.service.ts : line 112
- backend\src\users\users.service.ts : line 255
- backend\src\users\users.service.ts : line 356
- backend\src\users\users.service.ts : line 564
```


### Matches: city

```
- backend\src\company\company.dto.ts : line 14
- backend\src\company\company.service.ts : line 18
- backend\src\company\company.service.ts : line 31
- backend\src\company\company.service.ts : line 44
- backend\src\company\company.service.ts : line 59
- backend\src\users\me.dto.ts : line 32
- backend\src\users\me.service.ts : line 72
- backend\src\users\me.service.ts : line 95
- backend\src\users\users.dto.ts : line 35
- backend\src\users\users.dto.ts : line 112
- backend\src\users\users.dto.ts : line 144
- backend\src\users\users.dto.ts : line 162
- backend\src\users\users.service.ts : line 65
- backend\src\users\users.service.ts : line 113
- backend\src\users\users.service.ts : line 256
- backend\src\users\users.service.ts : line 357
- backend\src\users\users.service.ts : line 565
```


### Matches: state

```
- backend\src\agents\agents.controller.ts : line 97
- backend\src\agents\agents.controller.ts : line 101
- backend\src\agents\agents.controller.ts : line 104
- backend\src\alerts\alerts.controller.ts : line 11
- backend\src\alerts\alerts.controller.ts : line 14
- backend\src\alerts\alerts.service.ts : line 4
- backend\src\alerts\alerts.service.ts : line 14
- backend\src\alerts\alerts.service.ts : line 18
- backend\src\alerts\alerts.service.ts : line 35
- backend\src\alerts\alerts.service.ts : line 56
- backend\src\alerts\alerts.service.ts : line 61
- backend\src\alerts\alerts.service.ts : line 66
- backend\src\alerts\alerts.service.ts : line 71
- backend\src\backups\backups.service.ts : line 611
- backend\src\common\ui-socket-registry.service.ts : line 18
- backend\src\company\company.dto.ts : line 15
- backend\src\company\company.service.ts : line 18
- backend\src\company\company.service.ts : line 31
- backend\src\company\company.service.ts : line 45
- backend\src\company\company.service.ts : line 60
- backend\src\imap\imap-state.repository.ts : line 1
- backend\src\imap\imap-state.repository.ts : line 4
- backend\src\imap\imap-state.repository.ts : line 15
- backend\src\imap\imap-state.repository.ts : line 26
- backend\src\imap\imap-state.repository.ts : line 32
- backend\src\imap\imap-state.repository.ts : line 41
- backend\src\jobs\dispatcher.service.ts : line 62
- backend\src\realtime\ws.gateway.ts : line 19
- backend\src\users\me.dto.ts : line 35
- backend\src\users\me.service.ts : line 73
- backend\src\users\me.service.ts : line 96
- backend\src\users\users.dto.ts : line 36
- backend\src\users\users.dto.ts : line 113
- backend\src\users\users.dto.ts : line 145
- backend\src\users\users.dto.ts : line 163
- backend\src\users\users.service.ts : line 66
- backend\src\users\users.service.ts : line 114
- backend\src\users\users.service.ts : line 257
- backend\src\users\users.service.ts : line 358
- backend\src\users\users.service.ts : line 566
- backend\src\ws\agent.gateway.ts : line 180
```


### Matches: postal

```
- backend\src\company\company.dto.ts : line 16
- backend\src\company\company.service.ts : line 18
- backend\src\company\company.service.ts : line 31
- backend\src\company\company.service.ts : line 46
- backend\src\company\company.service.ts : line 61
- backend\src\users\me.dto.ts : line 38
- backend\src\users\me.service.ts : line 74
- backend\src\users\me.service.ts : line 97
- backend\src\users\users.dto.ts : line 37
- backend\src\users\users.dto.ts : line 114
- backend\src\users\users.dto.ts : line 146
- backend\src\users\users.dto.ts : line 164
- backend\src\users\users.service.ts : line 67
- backend\src\users\users.service.ts : line 115
- backend\src\users\users.service.ts : line 258
- backend\src\users\users.service.ts : line 359
- backend\src\users\users.service.ts : line 567
```


### Matches: zip

```
- backend\src\backups\worker.service.ts : line 264
- backend\src\devices\device-insights.controller.ts : line 45
```


### Matches: country

```
- backend\src\company\company.dto.ts : line 17
- backend\src\company\company.service.ts : line 18
- backend\src\company\company.service.ts : line 31
- backend\src\company\company.service.ts : line 47
- backend\src\company\company.service.ts : line 62
- backend\src\users\me.dto.ts : line 41
- backend\src\users\me.service.ts : line 75
- backend\src\users\me.service.ts : line 98
- backend\src\users\users.dto.ts : line 38
- backend\src\users\users.dto.ts : line 115
- backend\src\users\users.dto.ts : line 147
- backend\src\users\users.dto.ts : line 165
- backend\src\users\users.service.ts : line 68
- backend\src\users\users.service.ts : line 116
- backend\src\users\users.service.ts : line 259
- backend\src\users\users.service.ts : line 360
- backend\src\users\users.service.ts : line 568
```


### Matches: timezone

```
- backend\src\backups\cron-preview.service.ts : line 22
- backend\src\backups\scheduler.service.ts : line 56
- backend\src\localization\localization.dto.ts : line 22
- backend\src\localization\localization.service.ts : line 17
- backend\src\localization\localization.service.ts : line 48
- backend\src\users\me.dto.ts : line 19
- backend\src\users\me.service.ts : line 66
- backend\src\users\me.service.ts : line 90
- backend\src\users\users.dto.ts : line 132
- backend\src\users\users.dto.ts : line 154
```


### Matches: locale

```
- backend\src\backups\cron-preview.service.ts : line 21
- backend\src\users\me.dto.ts : line 22
- backend\src\users\me.service.ts : line 67
- backend\src\users\me.service.ts : line 91
- backend\src\users\users.dto.ts : line 133
- backend\src\users\users.dto.ts : line 155
```


### Matches: avatar_url

```
- backend\src\users\me.service.ts : line 68
- backend\src\users\me.service.ts : line 85
- backend\src\users\me.service.ts : line 92
- backend\src\users\me.service.ts : line 111
- backend\src\users\me.service.ts : line 132
- backend\src\users\me.service.ts : line 133
- backend\src\users\me.service.ts : line 136
- backend\src\users\me.service.ts : line 141
- backend\src\users\me.service.ts : line 149
- backend\src\users\users.dto.ts : line 40
- backend\src\users\users.service.ts : line 69
- backend\src\users\users.service.ts : line 117
- backend\src\users\users.service.ts : line 260
- backend\src\users\users.service.ts : line 361
- backend\src\users\users.service.ts : line 569
```


### Matches: avatarThumbUrl

```
- backend\src\users\me.dto.ts : line 48
- backend\src\users\me.service.ts : line 69
- backend\src\users\users.dto.ts : line 42
- backend\src\users\users.dto.ts : line 119
- backend\src\users\users.dto.ts : line 139
- backend\src\users\users.dto.ts : line 158
- backend\src\users\users.service.ts : line 118
- backend\src\users\users.service.ts : line 570
```


### Matches: avatar_thumb_url

```
- backend\src\users\me.controller.ts : line 148
- backend\src\users\me.service.ts : line 69
- backend\src\users\me.service.ts : line 112
- backend\src\users\me.service.ts : line 132
- backend\src\users\me.service.ts : line 133
- backend\src\users\me.service.ts : line 136
- backend\src\users\me.service.ts : line 142
- backend\src\users\users.dto.ts : line 40
- backend\src\users\users.service.ts : line 70
- backend\src\users\users.service.ts : line 118
- backend\src\users\users.service.ts : line 261
- backend\src\users\users.service.ts : line 362
- backend\src\users\users.service.ts : line 570
```

