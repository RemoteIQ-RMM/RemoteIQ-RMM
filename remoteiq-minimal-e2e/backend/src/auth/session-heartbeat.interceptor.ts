// backend/src/auth/session-heartbeat.interceptor.ts
import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { PgPoolService } from "../storage/pg-pool.service";

/**
 * Updates sessions.last_seen_at for authenticated web users.
 * - NO-OP when req.user or req.jti are missing
 * - NO-OP for non-API paths and obvious public routes
 * - Never throws; DB errors are swallowed
 */
@Injectable()
export class SessionHeartbeatInterceptor implements NestInterceptor {
    constructor(private readonly pg: PgPoolService) { }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const http = context.switchToHttp();
        const req = http.getRequest<Request>();

        // Only touch HTTP requests
        if (!req || !req.url) return next.handle();

        const url = req.url;

        // Skip non-API requests and public/docs/static routes
        // (adjust if your app has different mounts)
        const skip =
            !url.startsWith("/api") ||
            url.startsWith("/docs") ||
            url.startsWith("/static") ||
            url === "/healthz";

        if (skip) return next.handle();

        const user: any = (req as any).user;
        const jti: any = (req as any).jti;

        // If not authenticated or no JTI, do nothing
        if (!user?.id || !jti) {
            return next.handle();
        }

        // Capture request metadata before the stream completes
        const userId = String(user.id);
        const jtiText = String(jti);
        const ua = String(req.headers["user-agent"] || "");
        const ip =
            (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
            (req.socket as any)?.remoteAddress ||
            null;

        return next.handle().pipe(
            finalize(() => {
                // Fire-and-forget: never block response, never throw
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
                        // swallow errors; optionally add dev-only log:
                        if (process.env.NODE_ENV !== "production") {
                            // console.debug("Session heartbeat failed:", err?.message);
                        }
                    });
            }),
        );
    }
}
