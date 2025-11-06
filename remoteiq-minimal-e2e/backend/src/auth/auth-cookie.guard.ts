import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { JwtService } from "@nestjs/jwt";
import { PgPoolService } from "../storage/pg-pool.service";
import { randomUUID, createHash } from "crypto";

function parseCookieMaxAge(): number {
    const v = process.env.AUTH_COOKIE_MAX_AGE_MS;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 7 * 24 * 60 * 60 * 1000;
}

function hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

type DbUserRow = {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    status: string;
    organization_id: string;
    roles: any;
    permissions: string[] | null;
};

function buildDisplayName(first: string | null, last: string | null, fallback?: string | null): string | null {
    const parts = [first?.trim(), last?.trim()].filter(Boolean) as string[];
    if (parts.length > 0) return parts.join(" ");
    return fallback ?? null;
}

@Injectable()
export class AuthCookieGuard implements CanActivate {
    constructor(
        private readonly jwt: JwtService,
        private readonly pg: PgPoolService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<Request>();
        const res = context.switchToHttp().getResponse<Response>();

        const cookieName = process.env.AUTH_COOKIE_NAME || "auth_token";
        const tokenFromCookie =
            (req as any).cookies?.[cookieName] ||
            (req as any).cookies?.["auth_token"];
        const tokenFromHeader =
            req.headers.authorization?.replace(/^Bearer\s+/i, "") || null;

        const token = tokenFromCookie || tokenFromHeader;
        if (!token) throw new UnauthorizedException("No auth token provided");

        let payload: any;
        try {
            payload = await this.jwt.verifyAsync(token, {
                secret: process.env.JWT_SECRET ?? "dev-secret",
            });
        } catch {
            throw new UnauthorizedException("Invalid token");
        }
        if (!payload?.sub) throw new UnauthorizedException("Invalid token payload");

        const userRow = await this.loadUserById(String(payload.sub));
        if (!userRow || userRow.status !== "active") {
            throw new UnauthorizedException("Account disabled");
        }

        const roles: string[] = Array.isArray(userRow.roles)
            ? userRow.roles.map((r: any) => String(r.name ?? r).trim()).filter(Boolean)
            : [];
        const permissions = Array.isArray(userRow.permissions)
            ? userRow.permissions.map((p) => String(p).toLowerCase())
            : [];
        const displayName = buildDisplayName(userRow.first_name, userRow.last_name, payload.name);
        const primaryRole = roles[0] || payload.role || "user";

        (req as any).user = {
            id: userRow.id,
            email: userRow.email,
            name: displayName,
            organizationId: userRow.organization_id,
            roles,
            role: primaryRole,
            permissions,
        };

        let jti: string | null = payload?.jti != null ? String(payload.jti) : null;
        if (!jti) {
            jti = randomUUID();
            const newToken = await this.jwt.signAsync({
                sub: payload.sub,
                email: payload.email,
                name: displayName,
                role: primaryRole,
                org: userRow.organization_id,
            perms: permissions,
                jti,
            });

            res.cookie(cookieName, newToken, {
                httpOnly: true,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
                path: "/",
                maxAge: parseCookieMaxAge(),
            });

            const ipHdr = (req.headers["x-forwarded-for"] as string) || "";
            const ip = (ipHdr.split(",")[0] || req.ip || "").trim() || null;
            const ua = req.get("user-agent") || null;

            await this.upsertSession(userRow.id, jti, ua, ip, hashToken(newToken));
        }

        (req as any).jti = jti;

        if (jti) {
            const ipHdr = (req.headers["x-forwarded-for"] as string) || "";
            const ip = (ipHdr.split(",")[0] || req.ip || "").trim() || null;
            const ua = req.get("user-agent") || null;
            this.pg
                .query(
                    `UPDATE sessions
             SET last_seen_at = now(),
                 ip_address = COALESCE($2, ip_address),
                 user_agent = COALESCE($3, user_agent)
           WHERE id = $1 AND revoked_at IS NULL`,
                    [jti, ip, ua],
                )
                .catch(() => { });
        }

        return true;
    }

    private async upsertSession(userId: string, sessionId: string, ua: string | null, ip: string | null, tokenHash: string) {
        await this.pg.query(
            `
        INSERT INTO sessions (id, user_id, refresh_token, user_agent, ip_address)
        VALUES ($2, $1, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
           SET last_seen_at = now(),
               user_agent   = COALESCE(EXCLUDED.user_agent, sessions.user_agent),
               ip_address   = COALESCE(EXCLUDED.ip_address, sessions.ip_address),
               refresh_token = EXCLUDED.refresh_token
        `,
            [userId, sessionId, tokenHash, ua || null, ip || null],
        );
    }

    private async loadUserById(userId: string): Promise<DbUserRow | null> {
        try {
            const { rows } = await this.pg.query<DbUserRow>(
                `SELECT
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.status,
                    u.organization_id,
                    COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'name', r.name))
                             FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS roles,
                    COALESCE(array_agg(DISTINCT rp.permission_key)
                             FILTER (WHERE rp.permission_key IS NOT NULL), '{}'::text[]) AS permissions
                 FROM public.users u
                 LEFT JOIN public.user_roles ur ON ur.user_id = u.id
                 LEFT JOIN public.roles r ON r.id = ur.role_id
                 LEFT JOIN public.role_permissions rp ON rp.role_id = r.id
                 WHERE u.id = $1
                 GROUP BY u.id`,
                [userId],
            );
            if (!rows.length) return null;
            const row = rows[0];
            return {
                ...row,
                roles: Array.isArray(row.roles) ? row.roles : [],
                permissions: Array.isArray(row.permissions) ? row.permissions : [],
            };
        } catch {
            return null;
        }
    }
}
