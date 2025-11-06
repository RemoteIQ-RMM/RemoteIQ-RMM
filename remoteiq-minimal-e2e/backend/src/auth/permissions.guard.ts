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


/**
 * Permission-only guard with NO aliases or owner/admin shortcuts.
 *
 * - Reads one or more permissions from @RequirePerm(...)
 * - Authorizes ONLY if the caller holds them
 *   • Single string  -> that permission must be present
 *   • String array   -> ALL listed permissions must be present
 * - Optional x-admin-api-key bypass for bootstrap/CLI when ADMIN_API_KEY is set
 *
 * Permissions are sourced from:
 *  1) req.user.permissions (array | map | comma string), else
 *  2) public.role_meta (auto-detect key/perms columns), else
 *  3) role_permissions + permissions tables (if present)
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly db: PgPoolService
    ) { }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const req = ctx.switchToHttp().getRequest<any>();

        // Required permissions (normalized to array by the decorator)
        const required: RequirePermMetadata | undefined =
            this.reflector.getAllAndOverride<RequirePermMetadata>(REQUIRE_PERM_KEY, [
                ctx.getHandler(),
                ctx.getClass(),
            ]);

        // Bootstrap/CLI bypass (header must exactly match env var)
        const apiKey = req.header?.("x-admin-api-key") ?? req.headers?.["x-admin-api-key"];
        if (apiKey && process.env.ADMIN_API_KEY && apiKey === process.env.ADMIN_API_KEY) {
            return true;
        }

        // Must be authenticated
        const user = req.user;
        if (!user) throw new ForbiddenException("Not authenticated");

        // If endpoint didn't declare a permission, allow
        if (!required || required.length === 0) return true;

        // 1) Take perms directly if attached to request
        let userPerms = this.normalizePerms(user.permissions);

        // 2) Else try role_meta (TEXT[] or JSON(B) array)
        if (userPerms.length === 0) {
            const roleId: string | undefined = user.role?.id ?? user.roleId ?? user.role_id ?? undefined;
            const roleName: string | undefined =
                (user.role?.name ?? user.roleName ?? (typeof user.role === "string" ? user.role : undefined))?.toString();

            userPerms = await this.loadPermsFromRoleMeta({ roleId, roleName });

            if (userPerms.length === 0) {
                userPerms = await this.loadPermsFromJoinTable(roleId);
            }
        }

        const userSet = new Set(userPerms.map((p) => p.toLowerCase()));

        // ALL-of semantics for arrays
        for (const r of required) {
            const key = String(r).toLowerCase();
            if (!userSet.has(key)) {
                throw new ForbiddenException("Insufficient permissions");
            }
        }

        return true;
    }

    /* ---------------- helpers ---------------- */

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

    /**
     * Read permissions from public.role_meta.
     * Auto-detects:
     *  - key column: role_name | name | role_id | id
     *  - perms column: permissions | scopes | entitlements | perms
     * Supports TEXT[] and JSON/JSONB arrays.
     */
    private async loadPermsFromRoleMeta(input: {
        roleId?: string;
        roleName?: string;
    }): Promise<string[]> {
        try {
            // If we only got roleId, resolve the role name from public.roles(name)
            let roleName = input.roleName;
            if (!roleName && input.roleId) {
                const r = await this.db.query(
                    `SELECT name FROM public.roles WHERE id = $1 LIMIT 1`,
                    [input.roleId]
                );
                roleName = r.rows?.[0]?.name ?? undefined;
            }
            if (!roleName) return [];

            // Read TEXT[] of permission keys
            const q = await this.db.query(
                `SELECT permissions FROM public.role_meta WHERE role_name = $1 LIMIT 1`,
                [roleName]
            );
            if (!q.rows.length || !Array.isArray(q.rows[0].permissions)) return [];
            return this.normalizePerms(q.rows[0].permissions);
        } catch {
            return [];
        }
    }


    /**
     * Optional fallback if you add normalized ACL tables later.
     * Expects role_permissions(role_id uuid, permission text)
     * and permissions(name text PK) — adjust as needed.
     */
    private async loadPermsFromJoinTable(roleId?: string): Promise<string[]> {
        if (!roleId) return [];
        try {
            const exJoin = await this.db.query(`SELECT to_regclass('public.role_permissions') AS t`);
            const exPerm = await this.db.query(`SELECT to_regclass('public.permissions') AS t`);
            if (!exJoin.rows?.[0]?.t || !exPerm.rows?.[0]?.t) return [];

            const r = await this.db.query(
                `SELECT p.key
     FROM public.role_permissions rp
     JOIN public.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = $1`,
                [roleId]
            );
            return r.rows.map((x: any) => String(x.key).toLowerCase());
        } catch {
            return [];
        }
    }
}
