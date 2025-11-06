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

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly db: PgPoolService
    ) { }

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const req = ctx.switchToHttp().getRequest<any>();

        const required: RequirePermMetadata | undefined =
            this.reflector.getAllAndOverride<RequirePermMetadata>(REQUIRE_PERM_KEY, [
                ctx.getHandler(),
                ctx.getClass(),
            ]);

        const apiKey = req.header?.("x-admin-api-key") ?? req.headers?.["x-admin-api-key"];
        if (apiKey && process.env.ADMIN_API_KEY && apiKey === process.env.ADMIN_API_KEY) {
            return true;
        }

        const user = req.user;
        if (!user) throw new ForbiddenException("Not authenticated");

        if (!required || required.length === 0) return true;

        let userPerms = this.normalizePerms(user.permissions);

        if (userPerms.length === 0) {
            const roleHints = this.extractRoleNames(user);
            if (roleHints.length) {
                const defaults = permsForRoles(roleHints);
                if (defaults.size) {
                    userPerms = Array.from(defaults);
                }
            }
        }

        if (userPerms.length === 0 && user.id) {
            userPerms = await this.loadPermsFromRoles(user.id);
        }

        const userSet = new Set(userPerms.map((p) => p.toLowerCase()));

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
                [userId],
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
