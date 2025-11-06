// backend/src/auth/session-heartbeat.middleware.ts
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { PgPoolService } from "../storage/pg-pool.service";

/**
 * SessionHeartbeatMiddleware
 * - Runs only where you register it (we’ll scope it to /api/users/me/* in AppModule)
 * - Requires req.user.id and req.jti (populated by your AuthCookieMiddleware)
 * - Updates sessions.last_seen_at AFTER the response to avoid blocking requests
 * - Never throws; errors are swallowed (optional debug log in dev)
 */
@Injectable()
export class SessionHeartbeatMiddleware implements NestMiddleware {
    constructor(private readonly pg: PgPoolService) { }

    use(req: Request, res: Response, next: NextFunction) {
        const user: any = (req as any).user;
        const jti: any = (req as any).jti;

        if (!user?.id || !jti) {
            return next();
        }

        const userId = String(user.id);
        const jtiText = String(jti);
        const ua = String(req.headers["user-agent"] || "");
        const ip =
            (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
            (req.socket as any)?.remoteAddress ||
            null;

        // Fire-and-forget after response completes
        res.on("finish", () => {
            this.pg
                .query(
                    `
          UPDATE sessions
             SET last_seen_at = now(),
                 user_agent   = COALESCE($3, user_agent),
                 ip_address   = COALESCE($4, ip_address)
           WHERE user_id = $1
             AND revoked_at IS NULL
             AND id::text = $2
          `,
                    [userId, jtiText, ua || null, ip || null],
                )
                .catch(() => {
                    // Optional dev log:
                    // if (process.env.NODE_ENV !== "production") console.debug("session heartbeat update failed");
                });
        });

        next();
    }
}
