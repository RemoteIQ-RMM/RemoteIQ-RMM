export type PermissionGroup = {
    key: string;
    label: string;
    items: readonly {
        key: string;
        label: string;
        description?: string;
    }[];
};

export const PERMISSION_GROUPS = [
    {
        key: "users",
        label: "Users",
        items: [
            { key: "users.read", label: "View users" },
            { key: "users.write", label: "Create/edit users" },
            { key: "users.delete", label: "Remove users" },
            { key: "users.2fa.reset", label: "Reset 2FA" },
        ] as const,
    },
    {
        key: "roles",
        label: "Roles",
        items: [
            { key: "roles.read", label: "View roles" },
            { key: "roles.write", label: "Create/edit roles" },
            { key: "roles.delete", label: "Delete roles" },
        ] as const,
    },
    {
        key: "teams",
        label: "Teams",
        items: [
            { key: "teams.read", label: "View teams" },
            { key: "teams.write", label: "Create/edit teams" },
            { key: "teams.delete", label: "Delete teams" },
        ] as const,
    },
    {
        key: "billing",
        label: "Billing",
        items: [
            { key: "billing.read", label: "View billing" },
            { key: "billing.write", label: "Manage billing" },
        ] as const,
    },
    {
        key: "settings",
        label: "Settings",
        items: [
            { key: "settings.read", label: "View settings" },
            { key: "settings.write", label: "Manage settings" },
        ] as const,
    },
    {
        key: "backups",
        label: "Backups",
        items: [
            { key: "backups.read", label: "View config and history" },
            { key: "backups.run", label: "Start, retry or cancel backups" },
            { key: "backups.prune", label: "Prune artifacts" },
            { key: "backups.manage", label: "Configure/test destinations" },
            { key: "backups.restore", label: "Initiate restores" },
            { key: "backups.download", label: "Download artifacts" },
        ] as const,
    },
] as const satisfies readonly PermissionGroup[];

type PermissionItem = (typeof PERMISSION_GROUPS)[number]["items"][number];

export type Permission = PermissionItem["key"];

export type PermissionDefinition = PermissionItem & {
    groupKey: string;
    groupLabel: string;
};

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = PERMISSION_GROUPS.flatMap(
    (group) =>
        group.items.map((item) => ({
            ...item,
            groupKey: group.key,
            groupLabel: group.label,
        }))
);

export const ALL_PERMISSIONS: Permission[] = PERMISSION_DEFINITIONS.map((d) => d.key);

// Optional role names if you still use a role -> default-permissions map somewhere
export type Role = "owner" | "admin" | "operator" | "viewer";

// Advisory defaults for built-in roles (guards still check req.user permissions).
export const rolePermissions: Record<Role, Permission[]> = {
    owner: [...ALL_PERMISSIONS],
    admin: [...ALL_PERMISSIONS],
    operator: [
        "users.read",
        "roles.read",
        "teams.read",
        "billing.read",
        "settings.read",
        "backups.read",
        "backups.run",
        "backups.download",
    ],
    viewer: [
        "users.read",
        "roles.read",
        "teams.read",
        "billing.read",
        "settings.read",
        "backups.read",
    ],
};

// ---- Helpers (optional, used by some older code paths) ----
export function permsForRoles(roles: string[] | undefined | null): Set<Permission> {
    const out = new Set<Permission>();
    if (!roles) return out;
    for (const r of roles) {
        const key = r as Role;
        const list = rolePermissions[key];
        if (list) list.forEach((p) => out.add(p));
    }
    return out;
}

export function hasPerm(roles: string[] | undefined | null, perm: Permission): boolean {
    return permsForRoles(roles).has(perm);
}
