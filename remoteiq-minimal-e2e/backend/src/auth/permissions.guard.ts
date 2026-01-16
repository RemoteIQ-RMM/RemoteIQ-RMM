import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRE_PERM_KEY, RequirePermMetadata } from "./require-perm.decorator";
import { PgPoolService } from "../storage/pg-pool.service";
import { permsForRoles } from "./policy";
import { IS_PUBLIC_KEY } from "./public.decorator";

function isPublicRequest(req: any): boolean {
  const path: string =
    req?.path || req?.url || req?.originalUrl || "";

  const method = String(req?.method || "GET").toUpperCase();

  // Swagger
  if (path === "/docs" || path.startsWith("/docs/")) return true;
  if (path === "/docs-json") return true;
  if (path === "/api/docs" || path.startsWith("/api/docs/")) return true;
  if (path === "/api/docs-json") return true;

  // Static
  if (path.startsWith("/static/")) return true;

  // Health
  if (method === "GET" && path === "/healthz") return true;
  if (method === "GET" && path === "/healthz/email") return true;

  // Auth bootstrap routes
  if (method === "POST" && path === "/api/auth/login") return true;
  if (method === "POST" && path === "/api/auth/2fa/verify") return true;
  if (method === "POST" && path === "/api/auth/logout") return true;

  // Branding fetch for login page
  if (method === "GET" && path === "/api/branding") return true;

  return false;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: PgPoolService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<any>();

    // 1) Explicit @Public() bypass
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // 2) Path allowlist bypass (keeps system working before we annotate controllers)
    if (isPublicRequest(req)) return true;

    const requiredFromMeta: RequirePermMetadata | undefined =
      this.reflector.getAllAndOverride<RequirePermMetadata>(REQUIRE_PERM_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);

    // Allow fully privileged admin API key (break-glass / automation use)
    const apiKey = req.header?.("x-admin-api-key") ?? req.headers?.["x-admin-api-key"];
    if (apiKey && process.env.ADMIN_API_KEY && apiKey === process.env.ADMIN_API_KEY) {
      return true;
    }

    const path: string =
      req?.path || req?.url || req?.originalUrl || "";

    const isAdminRoute = typeof path === "string" && path.startsWith("/api/admin");

    // If no @RequirePerm is set AND the route is under /api/admin,
    // require admin.access by default.
    const required: string[] =
      requiredFromMeta && requiredFromMeta.length > 0
        ? requiredFromMeta
        : isAdminRoute
          ? ["admin.access"]
          : [];

    // If nothing is required, PermissionsGuard should not block the request.
    // AuthCookieGuard is responsible for authn (deny-by-default).
    if (required.length === 0) return true;

    const user = req.user;
    if (!user) throw new ForbiddenException("Not authenticated");

    // ---- Build user permissions set ----
    let userPerms = this.normalizePerms(user.permissions);

    // Always merge role-default perms (owner/admin/operator/viewer) with explicit perms.
    const roleHints = this.extractRoleNames(user);
    if (roleHints.length) {
      const defaults = permsForRoles(roleHints);
      if (defaults.size) {
        userPerms = Array.from(new Set([...userPerms, ...Array.from(defaults)]));
      }
    }

    // If still empty, try loading from DB as a final fallback
    if (userPerms.length === 0 && user.id) {
      const fromDb = await this.loadPermsFromRoles(user.id);
      if (fromDb.length) {
        userPerms = Array.from(new Set([...userPerms, ...fromDb]));
      }
    }

    const userSet = new Set(userPerms.map((p) => String(p).toLowerCase()));

    for (const r of required) {
      const key = String(r).toLowerCase();
      if (!userSet.has(key)) {
        throw new ForbiddenException("Insufficient permissions");
      }
    }

    return true;
  }

  private normalizePerms(val: any): string[] {
    if (!val) return [];
    if (Array.isArray(val)) return val.map((x) => String(x).toLowerCase());
    if (typeof val === "object") return Object.keys(val).map((k) => k.toLowerCase());
    const s = String(val);
    if (s.includes(",")) {
      return s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    }
    return [s.toLowerCase()];
  }

  private async loadPermsFromRoles(userId: string): Promise<string[]> {
    try {
      const { rows } = await this.db.query<{ permission_key: string }>(
        `SELECT DISTINCT rp.permission_key
           FROM public.user_roles ur
           JOIN public.role_permissions rp ON rp.role_id = ur.role_id
          WHERE ur.user_id = $1`,
        [userId]
      );
      return rows.map((r) => r.permission_key.toLowerCase());
    } catch {
      return [];
    }
  }

  private extractRoleNames(user: any): string[] {
    const out = new Set<string>();
    const push = (val: unknown) => {
      if (!val) return;
      const name = String(val).trim();
      if (name) out.add(name.toLowerCase());
    };

    if (Array.isArray(user?.roles)) user.roles.forEach(push);
    push(user?.role);
    push(user?.roleName);
    push(user?.role_name);
    if (user?.role?.name) push(user.role.name);

    return Array.from(out);
  }
}
