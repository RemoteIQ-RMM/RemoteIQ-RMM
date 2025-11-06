import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { JwtService } from "@nestjs/jwt";
import { PgPoolService } from "../storage/pg-pool.service";

const SESSION_IDLE_UPDATE_SECS =
    parseInt(process.env.SESSION_IDLE_UPDATE_SECS || "300", 10) || 300;

type DbSessionRow = { revoked_at: string | null; last_seen_at: string };
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

function buildDisplayName(first: string | null, last: string | null): string | null {
    const parts = [first?.trim(), last?.trim()].filter(Boolean) as string[];
    if (parts.length === 0) return null;
    return parts.join(" ");
}

@Injectable()
export class AuthCookieMiddleware implements NestMiddleware {
    private readonly cookieName: string;

    constructor(
        private readonly jwt: JwtService,
        private readonly pg: PgPoolService,
    ) {
        this.cookieName = process.env.AUTH_COOKIE_NAME || "auth_token";
    }

    async use(req: Request & { user?: any; jti?: string }, res: Response, next: NextFunction) {
        try {
            const token = (req as any).cookies?.[this.cookieName];
            if (!token) return next();

            const payload = await this.jwt.verifyAsync<any>(token, {
                secret: process.env.JWT_SECRET ?? "dev-secret",
            });

            const userRow = await this.loadUserById(payload.sub);
            if (!userRow || userRow.status !== "active") {
                return next();
            }

            const displayName = buildDisplayName(userRow.first_name, userRow.last_name) || payload.name || null;
            const roles: string[] = Array.isArray(userRow.roles)
                ? userRow.roles.map((r: any) => String(r.name ?? r).trim()).filter(Boolean)
                : [];
            const permissions = Array.isArray(userRow.permissions)
                ? userRow.permissions.map((p) => String(p).toLowerCase())
                : [];
            const primaryRole = roles[0] || payload.role || "user";

            req.user = {
                id: userRow.id,
                email: userRow.email,
                name: displayName,
                organizationId: userRow.organization_id,
                roles,
                role: primaryRole,
                permissions,
            };
            req.jti = payload.jti;

            if (req.jti) {
                const session = await this.loadSession(req.jti);
                if (session?.revoked_at) {
                    return res.status(401).json({ message: "Session revoked." });
                }
                if (session) {
                    const lastSeen = new Date(session.last_seen_at).getTime();
                    const now = Date.now();
                    if ((now - lastSeen) / 1000 > SESSION_IDLE_UPDATE_SECS) {
                        await this.pg.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [req.jti]);
                    }
                }
            }
        } catch {
            // ignore broken/expired token; route can still choose to 401
        }
        next();
    }

    private async loadSession(id: string): Promise<DbSessionRow | null> {
        try {
            const { rows } = await this.pg.query<DbSessionRow>(
                `SELECT revoked_at, last_seen_at FROM sessions WHERE id = $1 LIMIT 1`,
                [id],
            );
            return rows[0] ?? null;
        } catch {
            return null;
        }
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
