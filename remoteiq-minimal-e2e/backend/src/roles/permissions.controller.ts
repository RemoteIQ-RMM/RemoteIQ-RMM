import { Controller, Get, UseGuards } from "@nestjs/common";
import { PermissionGroupDto, PermissionsIntrospectService } from "./permissions-introspect.service";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePerm } from "../auth/require-perm.decorator";

/**
 * Standalone controller to expose a canonical list of permission keys.
 * Path: /api/roles/permission-keys
 */
@UseGuards(PermissionsGuard)
@Controller("/api/roles")
export class RolesPermissionsController {
    constructor(private readonly introspect: PermissionsIntrospectService) { }

    @Get("permission-keys")
    @RequirePerm("roles.read")
    async listPermissionKeys(): Promise<{ permissions: string[]; groups: PermissionGroupDto[] }> {
        const [permissions, groups] = await Promise.all([
            this.introspect.listDistinctPermissionKeys(),
            this.introspect.listPermissionGroups(),
        ]);
        return { permissions, groups };
    }
}
