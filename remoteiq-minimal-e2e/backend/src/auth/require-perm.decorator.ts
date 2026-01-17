// remoteiq-minimal-e2e/backend/src/auth/require-perm.decorator.ts

import { SetMetadata } from "@nestjs/common";
import type { Permission } from "./policy";

/**
 * Metadata key consumed by the PermissionsGuard.
 * Always normalized to an array of Permission strings.
 */
export const REQUIRE_PERM_KEY = "require_perm";

/**
 * Attach one or more required permissions to a route or controller.
 *
 * Usage:
 *   @RequirePerm("backups.manage")
 *   @RequirePerm(["backups.read", "backups.download"])
 */
export const RequirePerm = (perm: Permission | Permission[]) =>
    SetMetadata(REQUIRE_PERM_KEY, Array.isArray(perm) ? perm : [perm]);

export type RequirePermMetadata = Permission[];
