import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";

/** Tight default: only allow authenticated admins.
 * Replace with your existing RBAC once wired.
 */
@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
        const req = ctx.switchToHttp().getRequest();
        // Example: if you have req.user / req.session
        const user = req.user || req.session?.user;
        if (!user) throw new ForbiddenException("Not authenticated");
        if (!user.roles || !Array.isArray(user.roles) || !user.roles.includes("admin")) {
            throw new ForbiddenException("Admin role required");
        }
        return true;
    }
}
