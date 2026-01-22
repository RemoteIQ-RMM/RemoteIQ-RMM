// remoteiq-minimal-e2e/backend/src/auth/policy.ts
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
    // ── Administration
    {
        key: "administration",
        label: "Administration",
        items: [
            {
                key: "admin.access",
                label: "Access admin dashboard",
                description: "View and access the Administration area.",
            },
        ] as const,
    },

    // ── Users
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

    // ── Roles
    {
        key: "roles",
        label: "Roles",
        items: [
            { key: "roles.read", label: "View roles" },
            { key: "roles.write", label: "Create/edit roles" },
            { key: "roles.delete", label: "Delete roles" },
        ] as const,
    },

    // ── Billing
    {
        key: "billing",
        label: "Billing",
        items: [
            {
                key: "billing.read",
                label: "View billing",
                description: "View billing settings, plans, payment methods, and billing overview.",
            },
            {
                key: "billing.write",
                label: "Manage billing",
                description: "Update billing settings, payment methods, and billing configuration.",
            },
            {
                key: "subscription.read",
                label: "View subscription",
                description: "View subscription plan and subscription status.",
            },
            {
                key: "subscription.write",
                label: "Manage subscription",
                description: "Change subscription plan, seats, cancellations, etc.",
            },
            {
                key: "invoices.read",
                label: "View invoices",
                description: "View invoice history and invoice details.",
            },
            {
                key: "invoices.write",
                label: "Manage invoices",
                description: "Create/adjust invoices, issue refunds/credits (where applicable).",
            },
        ] as const,
    },

    // ── Customers / Orgs
    {
        key: "customers",
        label: "Customers",
        items: [
            { key: "customers.read", label: "View customers/sites" },
            {
                key: "customers.write",
                label: "Create/edit customers/sites",
                description: "Create and manage customers (clients) and their sites.",
            },
        ] as const,
    },

    // ── Devices
    {
        key: "devices",
        label: "Devices",
        items: [
            { key: "devices.read", label: "View devices" },
            {
                key: "devices.write",
                label: "Manage devices",
                description: "Update device properties (e.g., move device between sites within same client).",
            },
            {
                key: "devices.actions",
                label: "Run device actions",
                description: "Reboot, patch, uninstall software, etc.",
            },
        ] as const,
    },

    // ── Checks
    {
        key: "checks",
        label: "Checks",
        items: [
            { key: "checks.read", label: "View checks and results" },
            { key: "checks.write", label: "Create/edit checks" },
            { key: "checks.delete", label: "Delete checks" },
            { key: "checks.run", label: "Run checks on-demand" },
        ] as const,
    },

    // ── Alerts
    {
        key: "alerts",
        label: "Alerts",
        items: [
            { key: "alerts.read", label: "View alerts" },
            { key: "alerts.manage", label: "Acknowledge/silence/resolve alerts" },
        ] as const,
    },

    // ── Tickets
    {
        key: "tickets",
        label: "Tickets",
        items: [
            { key: "tickets.read", label: "View tickets" },
            { key: "tickets.write", label: "Create/update tickets" },
            {
                key: "tickets.canned.read",
                label: "View canned responses (admin)",
                description: "View canned responses configuration in Administration.",
            },
            {
                key: "tickets.canned.write",
                label: "Manage canned responses (admin)",
                description: "Create/edit/delete canned responses in Administration.",
            },
        ] as const,
    },

    // ── Automation
    {
        key: "automation",
        label: "Automation",
        items: [
            { key: "automation.run", label: "Run automation jobs" },
            { key: "automation.read", label: "View automation job status/logs" },
        ] as const,
    },

    // ── Me (self-service)
    {
        key: "me",
        label: "My Account",
        items: [
            { key: "me.read", label: "View my profile" },
            { key: "me.write", label: "Edit my profile" },
            {
                key: "me.security",
                label: "Manage my security",
                description: "Change password, 2FA, tokens, sessions, WebAuthn",
            },
        ] as const,
    },

    // ── Settings
    {
        key: "settings",
        label: "Settings",
        items: [
            { key: "settings.read", label: "View settings" },
            { key: "settings.write", label: "Manage settings" },
        ] as const,
    },

    // ── Backups
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

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = PERMISSION_GROUPS.flatMap((group) =>
    group.items.map((item) => ({
        ...item,
        groupKey: group.key,
        groupLabel: group.label,
    }))
);

export const ALL_PERMISSIONS: Permission[] = PERMISSION_DEFINITIONS.map((d) => d.key);

export type Role = "owner" | "admin" | "operator" | "viewer";

export const rolePermissions: Record<Role, Permission[]> = {
    owner: [...ALL_PERMISSIONS],
    admin: [...ALL_PERMISSIONS],
    operator: [
        "admin.access",
        "users.read",
        "roles.read",

        "billing.read",
        "subscription.read",
        "invoices.read",

        "customers.read",
        "customers.write",

        "devices.read",
        "devices.write",
        "devices.actions",

        "checks.read",
        "checks.run",
        "alerts.read",
        "alerts.manage",
        "tickets.read",
        "tickets.write",
        "automation.run",
        "automation.read",
        "settings.read",
        "backups.read",
        "backups.run",
        "backups.download",
    ],
    viewer: [
        "admin.access",
        "users.read",
        "roles.read",

        "billing.read",
        "subscription.read",
        "invoices.read",

        "customers.read",

        "devices.read",

        "checks.read",
        "alerts.read",
        "tickets.read",
        "settings.read",
        "backups.read",
    ],
};

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
