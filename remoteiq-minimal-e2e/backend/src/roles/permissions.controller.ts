import { Controller, Get } from "@nestjs/common";
import {
    PermissionGroupDto,
    PermissionsIntrospectService,
} from "./permissions-introspect.service";
import { RequirePerm } from "../auth/require-perm.decorator";

/**
 * Standalone controller to expose a canonical list of permission keys.
 * Route: GET /api/roles/permission-keys
 */
@Controller("/api/roles")
export class RolesPermissionsController {
    constructor(private readonly introspect: PermissionsIntrospectService) { }

    @Get("permission-keys")
    @RequirePerm("roles.read")
    async listPermissionKeys(): Promise<{
        permissions: string[];
        groups: PermissionGroupDto[];
    }> {
        const [permissions, groups] = await Promise.all([
            this.introspect.listDistinctPermissionKeys(),
            this.introspect.listPermissionGroups(),
        ]);
        return { permissions, groups };
    }
}
