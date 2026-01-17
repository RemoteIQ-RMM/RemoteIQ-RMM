import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { AuthCookieGuard } from "./auth-cookie.guard";

/**
 * Global auth gate (deny-by-default).
 * - Allows @Public() routes
 * - Allows a small hard allowlist (login + branding + docs + preflight)
 * - Otherwise delegates to AuthCookieGuard (cookie/JWT verification + req.user hydration)
 */
@Injectable()
export class GlobalAuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly authCookie: AuthCookieGuard
    ) { }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);
        if (isPublic) return true;

        const req = ctx.switchToHttp().getRequest<Request>();
        const method = (req.method || "GET").toUpperCase();
        const rawUrl = (req.originalUrl || req.url || "").toString();
        const path = rawUrl.split("?")[0] || "/";

        // Always allow CORS preflight
        if (method === "OPTIONS") return true;

        // Hard allowlist for routes that must work unauthenticated
        if (this.isAllowlisted(method, path)) return true;

        return this.authCookie.canActivate(ctx);
    }

    private isAllowlisted(method: string, path: string): boolean {
        // Health (note: your /healthz express route bypasses Nest anyway; this also covers /healthz/email controller)
        if (method === "GET" && (path === "/healthz" || path === "/healthz/email")) return true;

        // Static assets (served by express middleware; included here for safety)
        if (path.startsWith("/static/")) return true;

        // Swagger docs (dev only, but allowlist is harmless in prod since swagger isn’t mounted)
        if (method === "GET") {
            if (path === "/docs" || path.startsWith("/docs/")) return true;
            if (path === "/api/docs" || path.startsWith("/api/docs/")) return true;
            if (path === "/docs-json" || path === "/api/docs-json") return true;
            if (path === "/api-json") return true;
        }

        // Branding GET must work on the login page (theme + logos)
        if (method === "GET" && path === "/api/branding") return true;

        // Auth endpoints that must work unauthenticated
        if (method === "POST" && path === "/api/auth/login") return true;
        if (method === "POST" && path === "/api/auth/2fa/verify") return true;

        return false;
    }
}
