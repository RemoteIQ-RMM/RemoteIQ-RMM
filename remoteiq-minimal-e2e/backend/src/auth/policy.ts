// Optional role names if you still use a role → default-permissions map somewhere
export type Role = "owner" | "admin" | "operator" | "viewer";

// Expand the union so controller strings type-check
export type Permission =
    | "backups.read"      // read config, list history, view logs/manifests
    | "backups.run"       // start a backup, retry/cancel jobs
    | "backups.prune"     // prune old artifacts
    | "backups.manage"    // change config, test destination (admin-ish)
    | "backups.restore"   // start restore
    | "backups.download"; // download archives

// If you still want a default map for built-in roles, keep it here.
// (Purely advisory — the guard does NOT auto-grant anything.)
export const rolePermissions: Record<Role, Permission[]> = {
    owner: [
        "backups.read",
        "backups.run",
        "backups.prune",
        "backups.manage",
        "backups.restore",
        "backups.download",
    ],
    admin: [
        "backups.read",
        "backups.run",
        "backups.prune",
        "backups.manage",
        "backups.restore",
        "backups.download",
    ],
    operator: [
        "backups.read",
        "backups.run",
        "backups.prune",
        "backups.download",
    ],
    viewer: [
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
        if (list) list.forEach(p => out.add(p));
    }
    return out;
}

export function hasPerm(roles: string[] | undefined | null, perm: Permission): boolean {
    return permsForRoles(roles).has(perm);
}
