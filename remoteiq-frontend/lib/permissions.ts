// lib/permissions.ts

export type Perm = string;

export function normPerm(p: unknown): string {
    return String(p ?? "").trim().toLowerCase();
}

export function hasPerm(
    perms: unknown,
    required: Perm | Perm[] | undefined | null
): boolean {
    const req = Array.isArray(required) ? required : required ? [required] : [];
    if (!req.length) return true;

    const set = new Set(
        Array.isArray(perms) ? perms.map(normPerm).filter(Boolean) : []
    );

    return req.every((r) => set.has(normPerm(r)));
}
