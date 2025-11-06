// app/administration/tabs/RolesTab.tsx
"use client";

import * as React from "react";
import { TabsContent } from "@/components/ui/tabs";
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
    Plus,
    MoreVertical,
    Pencil,
    Copy,
    Download,
    Trash2,
    Layers,
    Check,
    Zap,
    RefreshCw,
    ChevronDown,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import ExcelJS from "exceljs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/* ========= Types ========= */
export type Role = {
    id: string;
    name: string;
    description?: string;
    permissions: string[];
    usersCount?: number;
    createdAt?: string;
    updatedAt?: string;
};

type AnyRole = {
    id: string;
    name: string;
    description?: string;
    permissions: string[] | Record<string, boolean>;
    usersCount?: number;
    createdAt?: string;
    updatedAt?: string;
};

export type ToastFn = (t: {
    title: string;
    desc?: string;
    kind: "success" | "warning" | "destructive" | "default";
}) => void;

interface RolesTabProps {
    roles: any[];
    setRoles: React.Dispatch<React.SetStateAction<any[]>>;
    push: ToastFn;
    refetchRoles?: () => Promise<void>;
    setDeleteRoleId?: React.Dispatch<React.SetStateAction<string | null>>;
}

/* ========= Constants / helpers ========= */
const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_SORT: Sort = { key: "name", dir: "asc" };
const PROTECTED_NAMES = new Set(["owner", "admin"]);
const PROTECTED_FULL_LOCK = "owner";
const ROW_HEIGHT = 70;

type SortKey = "name" | "usersCount" | "updatedAt";
type SortDir = "asc" | "desc";
type Sort = { key: SortKey; dir: SortDir };

type PermGroup = {
    key: string;
    label: string;
    items: { key: string; label: string }[];
};

const DEFAULT_PERM_GROUPS: PermGroup[] = [
    {
        key: "users",
        label: "Users",
        items: [
            { key: "users.read", label: "View users" },
            { key: "users.write", label: "Create/edit users" },
            { key: "users.delete", label: "Remove users" },
            { key: "users.2fa.reset", label: "Reset 2FA" },
        ],
    },
    {
        key: "roles",
        label: "Roles",
        items: [
            { key: "roles.read", label: "roles.read" },
            { key: "roles.write", label: "roles.write" },
            { key: "roles.delete", label: "roles.delete" },
        ],
    },
    {
        key: "teams",
        label: "Teams",
        items: [
            { key: "teams.read", label: "teams.read" },
            { key: "teams.write", label: "teams.write" },
            { key: "teams.delete", label: "teams.delete" },
        ],
    },
    {
        key: "billing",
        label: "Billing",
        items: [
            { key: "billing.read", label: "billing.read" },
            { key: "billing.write", label: "billing.write" },
        ],
    },
    {
        key: "settings",
        label: "Settings",
        items: [
            { key: "settings.read", label: "settings.read" },
            { key: "settings.write", label: "settings.write" },
        ],
    },
    {
        key: "backups",
        label: "Backups",
        items: [
            { key: "backups.read", label: "View config and history" },
            { key: "backups.run", label: "Run, retry or cancel jobs" },
            { key: "backups.prune", label: "Prune artifacts" },
            { key: "backups.manage", label: "Configure/test destinations" },
            { key: "backups.restore", label: "Restore from backups" },
            { key: "backups.download", label: "Download backups" },
        ],
    },
];

function isProtectedRoleName(name: string) {
    return PROTECTED_NAMES.has(name.trim().toLowerCase());
}
function formatDate(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
}
function relativeTimeFromNow(iso?: string) {
    if (!iso) return "";
    const now = Date.now();
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const diff = Math.max(0, now - t);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    const yr = Math.floor(mo / 12);
    return `${yr}y ago`;
}
function sanitizeForCSVCell(v: string): string {
    if (/^[=+\-@]/.test(v)) return "'" + v;
    return v;
}

/* ========= Permission adapters ========= */
function isPermMap(p: AnyRole["permissions"]): p is Record<string, boolean> {
    return !!p && !Array.isArray(p) && typeof p === "object";
}
function toKeys(p: AnyRole["permissions"]): string[] {
    if (Array.isArray(p)) return p;
    if (!p) return [];
    return Object.entries(p)
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k);
}
function keysToMap(keys: string[]): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    keys.forEach((k) => (out[k] = true));
    return out;
}
function normalizeRole(r: AnyRole): Role {
    return {
        id: r.id,
        name: r.name,
        description: r.description,
        permissions: toKeys(r.permissions),
        usersCount: r.usersCount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    };
}

/* ========= Export columns ========= */
type ColumnKey =
    | "id"
    | "name"
    | "description"
    | "usersCount"
    | "permissions"
    | "createdAt"
    | "updatedAt";

const COLUMN_LABELS: Record<ColumnKey, string> = {
    id: "ID",
    name: "Name",
    description: "Description",
    usersCount: "Users",
    permissions: "Permissions",
    createdAt: "Created",
    updatedAt: "Updated",
};

const DEFAULT_EXPORT_COLUMNS: ColumnKey[] = [
    "name",
    "description",
    "usersCount",
    "permissions",
    "updatedAt",
];

/* ========= API base ========= */
function getApiBase(): string {
    const raw = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
    if (!raw) return "/api";
    return raw.endsWith("/api") ? raw : `${raw}/api`;
}
const API_BASE = getApiBase();

/* ========= Local API helpers ========= */
async function apiListRoles(): Promise<AnyRole[]> {
    const res = await fetch(`${API_BASE}/roles`, {
        cache: "no-store",
        credentials: "include",
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to list roles (${res.status}): ${txt || res.statusText}`);
    }
    return res.json();
}
async function apiCreateRole(payload: {
    name: string;
    description?: string;
    permissions: string[];
}): Promise<{ id: string }> {
    const res = await fetch(`${API_BASE}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to create role (${res.status}): ${txt || res.statusText}`);
    }
    return res.json();
}
async function apiUpdateRole(id: string, patch: Partial<Role>): Promise<void> {
    const res = await fetch(`${API_BASE}/roles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to update role (${res.status}): ${txt || res.statusText}`);
    }
}
async function apiDeleteRole(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/roles/${id}`, {
        method: "DELETE",
        credentials: "include",
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to delete role (${res.status}): ${txt || res.statusText}`);
    }
}

async function apiListPermissionGroups(): Promise<PermGroup[]> {
    const res = await fetch(`${API_BASE}/roles/permission-keys`, {
        cache: "no-store",
        credentials: "include",
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Failed to load permission catalog (${res.status}): ${txt || res.statusText}`);
    }
    const body = (await res.json().catch(() => ({}))) as { groups?: PermGroup[] };
    if (!Array.isArray(body.groups) || !body.groups.length) {
        return DEFAULT_PERM_GROUPS;
    }
    return body.groups.map((group) => ({
        key: group.key,
        label: group.label,
        items: Array.isArray(group.items)
            ? group.items.map((item) => ({ key: item.key, label: item.label }))
            : [],
    }));
}

/* ========= Component ========= */
export default function RolesTab({
    roles,
    setRoles,
    push,
    refetchRoles,
}: RolesTabProps) {
    const [permissionGroups, setPermissionGroups] = React.useState<PermGroup[]>(DEFAULT_PERM_GROUPS);
    const allPermissionKeys = React.useMemo(
        () => permissionGroups.flatMap((g) => g.items.map((i) => i.key)),
        [permissionGroups]
    );

    // Track whether backend originally returns a map or an array for permissions
    const originalIsMapRef = React.useRef<boolean>(
        roles.length ? isPermMap((roles[0] as AnyRole)?.permissions) : false
    );

    React.useEffect(() => {
        if (roles.length) {
            originalIsMapRef.current = isPermMap((roles[0] as AnyRole)?.permissions);
        }
    }, [roles]);

    const [loading, setLoading] = React.useState(false);

    const refreshFromServer = React.useCallback(
        async (toastOnSuccess = false) => {
            setLoading(true);
            try {
                const fresh = await apiListRoles(); // <- raw
                setRoles(fresh as any[]);
                originalIsMapRef.current = fresh.length
                    ? isPermMap(fresh[0]?.permissions as any)
                    : originalIsMapRef.current;
                if (toastOnSuccess) push({ title: "Roles synced", kind: "success" });
            } catch (e: any) {
                push({
                    title: "Refresh failed",
                    desc: e?.message ?? "Request failed",
                    kind: "destructive",
                });
            } finally {
                setLoading(false);
            }
        },
        [setRoles, push]
    );

    // Optional hydration if parent didn't preload
    React.useEffect(() => {
        if (!roles || roles.length === 0) {
            refreshFromServer(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const groups = await apiListPermissionGroups();
                if (!cancelled && groups.length) {
                    setPermissionGroups(groups);
                }
            } catch (e: any) {
                push({
                    title: "Failed to load permissions",
                    desc: e?.message ?? "Internal server error",
                    kind: "destructive",
                });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [push]);

    const normalized = React.useMemo<Role[]>(
        () => (roles as AnyRole[]).map(normalizeRole),
        [roles]
    );

    // ---- Toolbar state ----
    const [query, setQuery] = React.useState("");
    const [debounced, setDebounced] = React.useState("");
    React.useEffect(() => {
        const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 300);
        return () => clearTimeout(t);
    }, [query]);

    const [permFilter, setPermFilter] = React.useState<string>("__all__");
    const [sort, setSort] = React.useState<Sort>(DEFAULT_SORT);
    const [pageSize, setPageSize] =
        React.useState<typeof PAGE_SIZES[number]>(PAGE_SIZES[0]);
    const [page, setPage] = React.useState(1);
    const [virtualize, setVirtualize] = React.useState(false);
    const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

    // Reset page to 1 when core filters change
    React.useEffect(() => {
        setPage(1);
    }, [debounced, permFilter, sort.key, sort.dir]);

    const filtered = React.useMemo(() => {
        let rows = normalized;

        if (debounced) {
            rows = rows.filter((r) => {
                const t = `${r.name} ${r.description ?? ""}`.toLowerCase();
                return t.includes(debounced);
            });
        }

        if (permFilter !== "__all__") {
            rows = rows.filter((r) => r.permissions?.includes(permFilter));
        }

        rows = [...rows].sort((a, b) => {
            const dir = sort.dir === "asc" ? 1 : -1;
            if (sort.key === "name") {
                return a.name.localeCompare(b.name) * dir;
            }
            if (sort.key === "usersCount") {
                const av = a.usersCount ?? 0;
                const bv = b.usersCount ?? 0;
                return (av - bv) * dir;
            }
            const av = a.updatedAt ? Date.parse(a.updatedAt) : 0;
            const bv = b.updatedAt ? Date.parse(b.updatedAt) : 0;
            return (av - bv) * dir;
        });

        return rows;
    }, [normalized, debounced, permFilter, sort]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    React.useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [totalPages, page]);

    const paged = React.useMemo(() => {
        if (virtualize) return filtered;
        const start = (page - 1) * pageSize;
        return filtered.slice(start, start + pageSize);
    }, [filtered, virtualize, page, pageSize]);

    const toggleAllVisible = React.useCallback(
        (checked: boolean) => {
            setSelectedIds((prev) => {
                const ids = new Set(prev);
                const rows = paged.map((r) => r.id);
                if (checked) rows.forEach((id) => ids.add(id));
                else rows.forEach((id) => ids.delete(id));
                return [...ids];
            });
        },
        [paged]
    );

    const toggleOne = React.useCallback((id: string, checked: boolean) => {
        setSelectedIds((prev) =>
            checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)
        );
    }, []);

    const clearSelection = React.useCallback(() => setSelectedIds([]), []);

    async function safeWriteClipboard(text: string) {
        if (
            typeof navigator !== "undefined" &&
            navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function"
        ) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        return false;
    }

    const onCopyNames = React.useCallback(() => {
        const working = (selectedIds.length
            ? filtered.filter((r) => selectedIds.includes(r.id))
            : filtered
        ).map((r) => r.name);
        if (!working.length) {
            push({ title: "Nothing to copy", kind: "warning" });
            return;
        }
        safeWriteClipboard(working.join("\n")).then((ok) => {
            if (ok) {
                push({
                    title: "Copied role name(s)",
                    desc: `${working.length} copied`,
                    kind: "success",
                });
            } else {
                push({
                    title: "Copy failed",
                    desc: "Clipboard not available",
                    kind: "destructive",
                });
            }
        });
    }, [filtered, selectedIds, push]);

    /* ===== Export ===== */
    const [exportOpen, setExportOpen] = React.useState(false);
    const [exportScope, setExportScope] =
        React.useState<"selected" | "filtered" | "all">("filtered");
    const [exportColumns, setExportColumns] =
        React.useState<ColumnKey[]>(DEFAULT_EXPORT_COLUMNS);
    const [exportFormat, setExportFormat] = React.useState<"xlsx" | "csv">("xlsx");

    const rolesForExport = React.useMemo(() => {
        if (exportScope === "selected" && selectedIds.length) {
            return filtered.filter((r) => selectedIds.includes(r.id));
        }
        if (exportScope === "all") return normalized;
        return filtered;
    }, [exportScope, selectedIds, filtered, normalized]);

    const doExport = React.useCallback(async () => {
        const rows = rolesForExport;
        if (!rows.length) {
            push({ title: "Nothing to export", kind: "warning" });
            return;
        }

        if (exportFormat === "csv") {
            const header = exportColumns.map((c) => COLUMN_LABELS[c]);
            const lines = [header.join(",")];
            for (const r of rows) {
                const vals = exportColumns.map((c) => {
                    let val = "";
                    switch (c) {
                        case "id":
                            val = r.id;
                            break;
                        case "name":
                            val = r.name;
                            break;
                        case "description":
                            val = r.description ?? "";
                            break;
                        case "usersCount":
                            val = String(r.usersCount ?? 0);
                            break;
                        case "permissions":
                            val = (r.permissions ?? []).join("; ");
                            break;
                        case "createdAt":
                            val = r.createdAt ?? "";
                            break;
                        case "updatedAt":
                            val = r.updatedAt ?? "";
                            break;
                    }
                    val = sanitizeForCSVCell(val);
                    if (/[,"\n]/.test(val)) val = '"' + val.replace(/"/g, '""') + '"';
                    return val;
                });
                lines.push(vals.join(","));
            }
            const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `roles_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
            push({ title: "CSV exported", kind: "success" });
            setExportOpen(false);
            return;
        }

        // XLSX
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Roles");
        ws.addRow(exportColumns.map((c) => COLUMN_LABELS[c]));
        for (const r of rows) {
            const rowVals = exportColumns.map((c) => {
                switch (c) {
                    case "id":
                        return sanitizeForCSVCell(r.id);
                    case "name":
                        return sanitizeForCSVCell(r.name);
                    case "description":
                        return sanitizeForCSVCell(r.description ?? "");
                    case "usersCount":
                        return r.usersCount ?? 0;
                    case "permissions":
                        return sanitizeForCSVCell((r.permissions ?? []).join("; "));
                    case "createdAt":
                        return r.createdAt ?? "";
                    case "updatedAt":
                        return r.updatedAt ?? "";
                }
            });
            ws.addRow(rowVals as any);
        }
        (ws.columns || []).forEach((col: any) => {
            let max = 10;
            if (col?.eachCell) {
                col.eachCell((cell: any) => {
                    const len = String(cell?.value ?? "").length;
                    if (len > max) max = len;
                });
            }
            col.width = Math.min(60, Math.max(10, max + 2));
        });
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `roles_${Date.now()}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
        push({ title: "XLSX exported", kind: "success" });
        setExportOpen(false);
    }, [rolesForExport, exportFormat, exportColumns, push]);

    /* ===== Create/Edit/Delete ===== */
    const [editOpen, setEditOpen] = React.useState(false);
    const [editingRole, setEditingRole] = React.useState<Role | null>(null);

    const openCreate = React.useCallback(() => {
        setEditingRole({
            id: "",
            name: "",
            description: "",
            permissions: [],
        });
        setEditOpen(true);
    }, []);

    const openEdit = React.useCallback((r: Role) => {
        setEditingRole({ ...r });
        setEditOpen(true);
    }, []);

    const openDuplicate = React.useCallback((r: Role) => {
        setEditingRole({
            id: "",
            name: `${r.name} (copy)`,
            description: r.description ?? "",
            permissions: [...(r.permissions ?? [])],
        });
        setEditOpen(true);
    }, []);

    const nameIsUnique = React.useCallback(
        (name: string, excludingId?: string) => {
            const lowered = name.trim().toLowerCase();
            return !normalized.some(
                (r) => r.id !== excludingId && r.name.trim().toLowerCase() === lowered
            );
        },
        [normalized]
    );

    const submitEdit = React.useCallback(async () => {
        if (!editingRole) return;
        const { id, name, description, permissions } = editingRole;
        const trimmed = name.trim();
        const lowered = trimmed.toLowerCase();

        // prevent creating a new protected role
        if (!id && PROTECTED_NAMES.has(lowered)) {
            push({
                title: "Protected role name",
                desc: `"${trimmed}" is reserved and cannot be created`,
                kind: "warning",
            });
            return;
        }

        if (trimmed.length < 2 || trimmed.length > 64) {
            push({
                title: "Invalid name",
                desc: "Name must be 2–64 characters",
                kind: "warning",
            });
            return;
        }

        if (!nameIsUnique(trimmed, id || undefined)) {
            push({
                title: "Duplicate name",
                desc: "Role name must be unique (case-insensitive)",
                kind: "warning",
            });
            return;
        }

        // Build payload. For protected system roles, DO NOT send `name` at all.
        const isProtectedExisting = Boolean(id) && PROTECTED_NAMES.has(lowered);
        const payload: Partial<Role> = {
            // name only if not protected
            ...(isProtectedExisting ? {} : { name: trimmed }),
            description: (description ?? "").trim() || undefined,
            permissions: permissions ?? [],
        };

        if (!id) {
            // optimistic create
            const optimisticId = `tmp_${Math.random().toString(36).slice(2)}`;
            const optimistic: Role = {
                id: optimisticId,
                name: trimmed,
                description: payload.description,
                permissions: payload.permissions as string[],
                usersCount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            setRoles((prev) => {
                const backModeIsMap = originalIsMapRef.current;
                const out = backModeIsMap
                    ? { ...optimistic, permissions: keysToMap(optimistic.permissions) }
                    : { ...optimistic };
                return [out as any, ...prev];
            });
            setEditOpen(false);

            try {
                await apiCreateRole({
                    name: trimmed,
                    description: payload.description,
                    permissions: (payload.permissions as string[]) ?? [],
                });
                await refreshFromServer(true);
            } catch (e: any) {
                setRoles((prev) =>
                    prev.filter(
                        (r) => normalizeRole(r as unknown as AnyRole).id !== optimisticId
                    )
                );
                push({
                    title: "Create failed",
                    desc: e?.message ?? "Request failed",
                    kind: "destructive",
                });
            }
            return;
        }

        // editing existing
        const before = roles;
        const updated: Role = {
            ...editingRole,
            // only change name locally if not protected
            name: isProtectedExisting ? editingRole.name : trimmed,
            description: payload.description,
            permissions: (payload.permissions as string[]) ?? [],
            updatedAt: new Date().toISOString(),
        };

        setRoles((prev) =>
            prev.map((r) => {
                const n = normalizeRole(r as unknown as AnyRole);
                if (n.id !== id) return r;
                const out = originalIsMapRef.current
                    ? { ...updated, permissions: keysToMap(updated.permissions) }
                    : updated;
                return out as any;
            })
        );
        setEditOpen(false);

        try {
            await apiUpdateRole(id, payload);
            await refreshFromServer(false);
            push({ title: "Role updated", kind: "success" });
        } catch (e: any) {
            setRoles(before);
            push({
                title: "Update failed",
                desc: e?.message ?? "Request failed",
                kind: "destructive",
            });
        }
    }, [editingRole, nameIsUnique, push, roles, setRoles, refreshFromServer]);


    const [confirmDelete, setConfirmDelete] = React.useState<{
        open: boolean;
        ids: string[];
    }>({
        open: false,
        ids: [],
    });

    const attemptDeleteOne = React.useCallback(
        (r: Role) => {
            if (isProtectedRoleName(r.name)) {
                push({
                    title: "Protected role",
                    desc: "Owner/Admin cannot be deleted",
                    kind: "warning",
                });
                return;
            }
            if ((r.usersCount ?? 0) > 0) {
                push({
                    title: "Role in use",
                    desc: "Reassign users before deleting this role",
                    kind: "warning",
                });
                return;
            }
            setConfirmDelete({ open: true, ids: [r.id] });
        },
        [push]
    );

    const attemptBulkDelete = React.useCallback(() => {
        if (!selectedIds.length) return;
        const blocked: { name: string; reason: string }[] = [];
        const deletable: Role[] = [];
        for (const r of filtered) {
            if (!selectedIds.includes(r.id)) continue;
            if (isProtectedRoleName(r.name)) {
                blocked.push({ name: r.name, reason: "protected role" });
                continue;
            }
            if ((r.usersCount ?? 0) > 0) {
                blocked.push({ name: r.name, reason: "users assigned" });
                continue;
            }
            deletable.push(r);
        }
        if (blocked.length) {
            push({
                title: "Some roles cannot be deleted",
                desc:
                    blocked
                        .slice(0, 4)
                        .map((b) => `${b.name}: ${b.reason}`)
                        .join("; ") + (blocked.length > 4 ? "…" : ""),
                kind: "warning",
            });
        }
        if (!deletable.length) return;
        setConfirmDelete({ open: true, ids: deletable.map((r) => r.id) });
    }, [filtered, selectedIds, push]);

    const confirmPerformDelete = React.useCallback(async () => {
        const ids = confirmDelete.ids;
        setConfirmDelete({ open: false, ids: [] });
        if (!ids.length) return;

        const before = roles;
        setRoles((prev) =>
            prev.filter((r) => !ids.includes(normalizeRole(r as unknown as AnyRole).id))
        );

        try {
            for (const id of ids) {
                await apiDeleteRole(id);
            }
            await refreshFromServer(false);
            push({ title: ids.length > 1 ? "Roles deleted" : "Role deleted", kind: "success" });
        } catch (e: any) {
            setRoles(before);
            push({
                title: "Delete failed",
                desc: e?.message ?? "Request failed",
                kind: "destructive",
            });
        } finally {
            clearSelection();
            if (typeof refetchRoles === "function") {
                try {
                    await refetchRoles();
                } catch {
                    /* ignore */
                }
            }
        }
    }, [confirmDelete.ids, roles, setRoles, push, clearSelection, refetchRoles, refreshFromServer]);

    /* ===== Virtualization ===== */
    const parentRef = React.useRef<HTMLDivElement | null>(null);
    const rowVirtualizer = useVirtualizer({
        count: virtualize ? filtered.length : 0,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 10,
    });

    /* ===== Small helpers for display ===== */
    function permissionsPreview(perms: string[] = [], take = 3) {
        const list = perms.slice(0, take);
        const rest = Math.max(0, perms.length - list.length);
        const txt = list.join(", ") + (rest > 0 ? `, +${rest} more` : "");
        return { text: txt, title: perms.join(", ") };
    }

    /* ===== Render ===== */
    return (
        <TabsContent value="roles" className="mt-0">
            <Card>
                <CardHeader className="gap-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Roles</CardTitle>
                            <CardDescription>
                                Define access levels and permissions. Protected examples: Owner / Admin (cannot be deleted).
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setExportOpen(true)}
                                aria-label="Export roles"
                                title="Export…"
                            >
                                <Download className="h-4 w-4 mr-2" />
                                Export…
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onCopyNames}
                                aria-label="Copy role names"
                                title="Copy role names"
                            >
                                <Copy className="h-4 w-4 mr-2" />
                                Copy names
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => refreshFromServer(true)}
                                disabled={loading}
                                aria-label="Sync"
                                title="Sync with server"
                            >
                                <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                                Sync
                            </Button>
                            <Button size="sm" onClick={openCreate} aria-label="Create role">
                                <Plus className="h-4 w-4 mr-2" />
                                New role
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="space-y-3">
                    {/* Toolbar */}
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-2">
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search roles…"
                                className="w-[260px]"
                                aria-label="Search roles"
                            />
                            <Select value={permFilter} onValueChange={(v) => setPermFilter(v)}>
                                <SelectTrigger className="w-[260px]" aria-label="Filter by permission">
                                    <SelectValue placeholder="Filter by permission" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__all__">All permissions</SelectItem>
                                    {allPermissionKeys.map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {p}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center gap-2 whitespace-nowrap">
                            {/* Sort */}
                            <Select
                                value={`${sort.key}:${sort.dir}`}
                                onValueChange={(v) => {
                                    const [key, dir] = v.split(":") as [SortKey, SortDir];
                                    setSort({ key, dir });
                                }}
                            >
                                <SelectTrigger
                                    className="h-9 w-[140px] sm:w-[160px] md:w-[180px] min-w-0"
                                    aria-label="Sort roles"
                                >
                                    <SelectValue className="truncate" />
                                </SelectTrigger>
                                <SelectContent>
                                    <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground">
                                        Sort by
                                    </DropdownMenuLabel>
                                    <SelectItem value="name:asc">Name (A→Z)</SelectItem>
                                    <SelectItem value="name:desc">Name (Z→A)</SelectItem>
                                    <SelectItem value="usersCount:asc">Users (fewest)</SelectItem>
                                    <SelectItem value="usersCount:desc">Users (most)</SelectItem>
                                    <SelectItem value="updatedAt:desc">Updated (newest)</SelectItem>
                                    <SelectItem value="updatedAt:asc">Updated (oldest)</SelectItem>
                                </SelectContent>
                            </Select>

                            {/* Pagination size */}
                            {!virtualize && (
                                <Select
                                    value={String(pageSize)}
                                    onValueChange={(v) => setPageSize(Number(v) as any)}
                                >
                                    <SelectTrigger className="w-[120px]" aria-label="Rows per page">
                                        <SelectValue placeholder="Rows" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PAGE_SIZES.map((n) => (
                                            <SelectItem key={n} value={String(n)}>
                                                {n} / page
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                            {/* Virtualize toggle */}
                            <Button
                                variant={virtualize ? "default" : "outline"}
                                size="sm"
                                onClick={() => setVirtualize((v) => !v)}
                                aria-pressed={virtualize}
                                title="Toggle virtualization"
                            >
                                <Zap className="h-4 w-4 mr-2" />
                                {virtualize ? "Virtualized" : "Virtualize"}
                            </Button>
                        </div>
                    </div>

                    {/* Bulk bar */}
                    {selectedIds.length > 0 && (
                        <div className="flex items-center justify-between rounded-md border px-3 py-2">
                            <div className="text-sm">
                                <strong>{selectedIds.length}</strong> selected
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={attemptBulkDelete}
                                    aria-label="Bulk delete roles"
                                    title="Bulk delete"
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                </Button>
                                <Button variant="outline" size="sm" onClick={clearSelection} aria-label="Clear selection">
                                    Clear
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Table */}
                    <div className="rounded-md border">
                        {/* header */}
                        <div className="grid grid-cols-[40px_1fr_120px_220px_56px] items-center gap-2 border-b px-3 py-2 text-xs font-semibold text-muted-foreground">
                            <div className="flex items-center justify-center">
                                <Checkbox
                                    aria-label="Select all on page"
                                    checked={paged.length > 0 && paged.every((r) => selectedIds.includes(r.id))}
                                    onCheckedChange={(v) => toggleAllVisible(Boolean(v))}
                                />
                            </div>
                            <div>Name</div>
                            <div className="text-right pr-2">Users</div>
                            <div>Updated</div>
                            <div className="text-right">Actions</div>
                        </div>

                        {/* body */}
                        {virtualize ? (
                            <div
                                ref={parentRef}
                                className="h-[520px] overflow-auto"
                                role="table"
                                aria-label="Roles table virtualized"
                            >
                                <div style={{ height: rowVirtualizer.getTotalSize() }} className="relative">
                                    {rowVirtualizer.getVirtualItems().map((vi) => {
                                        const r = filtered[vi.index];
                                        const isSelected = selectedIds.includes(r.id);
                                        const pv = permissionsPreview(r.permissions, 3);
                                        return (
                                            <div
                                                key={r.id}
                                                className={cn(
                                                    "absolute left-0 right-0 grid grid-cols-[40px_1fr_120px_180px_56px] items-center gap-2 border-b px-3 h-[60px]",
                                                    isSelected && "bg-primary/5"
                                                )}
                                                style={{ transform: `translateY(${vi.start}px)`, height: ROW_HEIGHT }}
                                            >
                                                <div className="flex items-center justify-center">
                                                    <Checkbox
                                                        checked={isSelected}
                                                        onCheckedChange={(v) => toggleOne(r.id, Boolean(v))}
                                                        aria-label={`Select ${r.name}`}
                                                    />
                                                </div>

                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="truncate font-medium">{r.name}</span>
                                                        {isProtectedRoleName(r.name) && (
                                                            <Badge variant="secondary" title="System role">
                                                                System
                                                            </Badge>
                                                        )}
                                                        <Badge variant="outline" title={r.permissions.join(", ")}>
                                                            {r.permissions.length} perms
                                                        </Badge>
                                                    </div>
                                                    {r.description && (
                                                        <div className="truncate text-xs text-muted-foreground">
                                                            {r.description}
                                                        </div>
                                                    )}
                                                    {r.permissions?.length > 0 && (
                                                        <div className="truncate text-[11px] text-muted-foreground" title={pv.title}>
                                                            {pv.text}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="text-right pr-2">{r.usersCount ?? 0}</div>

                                                <div className="truncate text-sm" title={r.updatedAt ?? ""}>
                                                    {relativeTimeFromNow(r.updatedAt) || formatDate(r.updatedAt)}
                                                </div>

                                                <div className="flex items-center justify-end">
                                                    <RowActions
                                                        role={r}
                                                        onEdit={() => openEdit(r)}
                                                        onDuplicate={() => openDuplicate(r)}
                                                        onDelete={() => attemptDeleteOne(r)}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <>
                                {paged.map((r) => {
                                    const isSelected = selectedIds.includes(r.id);
                                    const pv = permissionsPreview(r.permissions, 3);
                                    return (
                                        <div
                                            key={r.id}
                                            className={cn(
                                                "grid grid-cols-[40px_1fr_120px_180px_56px] items-center gap-2 border-b px-3 h-[60px]",
                                                isSelected && "bg-primary/5"
                                            )}
                                            style={{ height: ROW_HEIGHT }}
                                        >
                                            <div className="flex items-center justify-center">
                                                <Checkbox
                                                    checked={isSelected}
                                                    onCheckedChange={(v) => toggleOne(r.id, Boolean(v))}
                                                    aria-label={`Select ${r.name}`}
                                                />
                                            </div>

                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="truncate font-medium">{r.name}</span>
                                                    {isProtectedRoleName(r.name) && (
                                                        <Badge variant="secondary" title="System role">
                                                            System
                                                        </Badge>
                                                    )}
                                                    <Badge variant="outline" title={r.permissions.join(", ")}>
                                                        {r.permissions.length} perms
                                                    </Badge>
                                                </div>
                                                {r.description && (
                                                    <div className="truncate text-xs text-muted-foreground">
                                                        {r.description}
                                                    </div>
                                                )}
                                                {r.permissions?.length > 0 && (
                                                    <div className="truncate text-[11px] text-muted-foreground" title={pv.title}>
                                                        {pv.text}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="text-right pr-2">{r.usersCount ?? 0}</div>

                                            <div className="truncate text-sm" title={r.updatedAt ?? ""}>
                                                {relativeTimeFromNow(r.updatedAt) || formatDate(r.updatedAt)}
                                            </div>

                                            <div className="flex items-center justify-end">
                                                <RowActions
                                                    role={r}
                                                    onEdit={() => openEdit(r)}
                                                    onDuplicate={() => openDuplicate(r)}
                                                    onDelete={() => attemptDeleteOne(r)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* pager */}
                                <div className="flex items-center justify-between px-3 py-2">
                                    <div className="text-xs text-muted-foreground">
                                        {filtered.length} role(s)
                                        {filtered.length !== normalized.length && ` • filtered from ${normalized.length}`}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={page <= 1}
                                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        >
                                            Prev
                                        </Button>
                                        <div className="text-sm">
                                            Page {page} / {totalPages}
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={page >= totalPages}
                                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                        >
                                            Next
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* subtle loading indicator */}
                    {loading && (
                        <div className="text-xs text-muted-foreground flex items-center gap-2 pl-1">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            Syncing…
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Create/Edit Role Dialog — redesigned for better fit */}
            <Dialog open={editOpen} onOpenChange={(v) => setEditOpen(v)}>
                <DialogContent
                    // Wider but clamped; internal scroll area handles height
                    className={cn(
                        "w-[min(100vw-2rem,1100px)] max-w-none p-0 overflow-hidden"
                    )}
                >
                    <DialogHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b px-6 py-4">
                        <DialogTitle>{editingRole?.id ? "Edit role" : "New role"}</DialogTitle>
                        <DialogDescription>
                            {editingRole?.id
                                ? "Update the role name, description and permissions."
                                : "Create a new role with the permissions you choose."}
                        </DialogDescription>
                    </DialogHeader>

                    {editingRole && (
                        <>
                            {/* Scroll body */}
                            <div className="max-h-[75vh] overflow-auto px-6 py-4">
                                <div className="grid gap-3 md:grid-cols-2">
                                    <div className="grid gap-1">
                                        <label className="text-sm">Name</label>
                                        <Input
                                            value={editingRole.name}
                                            onChange={(e) =>
                                                setEditingRole((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                                            }
                                            placeholder="e.g. Support Agent"
                                            aria-label="Role name"
                                            disabled={
                                                Boolean(editingRole.id) &&
                                                editingRole.name.trim().toLowerCase() === PROTECTED_FULL_LOCK
                                            }
                                        />
                                    </div>
                                    <div className="grid gap-1">
                                        <label className="text-sm">Description (optional)</label>
                                        <Input
                                            value={editingRole.description ?? ""}
                                            onChange={(e) =>
                                                setEditingRole((prev) =>
                                                    prev ? { ...prev, description: e.target.value } : prev
                                                )
                                            }
                                            placeholder="Short description"
                                            aria-label="Role description"
                                        />
                                    </div>
                                </div>

                                {/* Permission checklist (accordion/compact) */}
                                <div className="rounded-md border mt-3">
                                    <div className="flex items-center justify-between px-3 py-2 border-b">
                                        <div className="font-medium text-sm">Permissions</div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    setEditingRole((prev) =>
                                                        prev ? { ...prev, permissions: [...allPermissionKeys] } : prev
                                                    )
                                                }
                                                aria-label="Check all permissions"
                                                title="Grant all permissions"
                                            >
                                                <Check className="h-4 w-4 mr-2" />
                                                All permissions
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    setEditingRole((prev) => (prev ? { ...prev, permissions: [] } : prev))
                                                }
                                                aria-label="Uncheck all permissions"
                                                title="Revoke all"
                                            >
                                                Clear
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="p-2 sm:p-3 space-y-2">
                                        {permissionGroups.map((group) => {
                                            const groupKeys = group.items.map((i) => i.key);
                                            const hasAll =
                                                editingRole.permissions &&
                                                groupKeys.every((k) => (editingRole.permissions ?? []).includes(k));
                                            const hasSome =
                                                editingRole.permissions &&
                                                groupKeys.some((k) => (editingRole.permissions ?? []).includes(k));

                                            return (
                                                <details
                                                    key={group.key}
                                                    className="rounded-md border"
                                                    open
                                                >
                                                    <summary className="flex items-center justify-between cursor-pointer list-none px-3 py-2 select-none">
                                                        <div className="flex items-center gap-2">
                                                            <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                                                            <span className="font-medium">{group.label}</span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {hasAll ? "All" : hasSome ? "Partial" : "None"}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    setEditingRole((prev) => {
                                                                        if (!prev) return prev;
                                                                        const next = new Set(prev.permissions ?? []);
                                                                        groupKeys.forEach((k) => next.add(k));
                                                                        return { ...prev, permissions: [...next] };
                                                                    });
                                                                }}
                                                                aria-label={`Grant all ${group.label}`}
                                                                title={`Grant all ${group.label}`}
                                                            >
                                                                <Layers className="h-4 w-4 mr-2" />
                                                                Check all
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    setEditingRole((prev) => {
                                                                        if (!prev) return prev;
                                                                        const next = new Set(prev.permissions ?? []);
                                                                        groupKeys.forEach((k) => next.delete(k));
                                                                        return { ...prev, permissions: [...next] };
                                                                    });
                                                                }}
                                                                aria-label={`Revoke all ${group.label}`}
                                                                title={`Revoke all ${group.label}`}
                                                            >
                                                                Clear
                                                            </Button>
                                                        </div>
                                                    </summary>

                                                    <div className="px-3 pb-3">
                                                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                                            {group.items.map((p) => {
                                                                const checked = editingRole.permissions?.includes(p.key) ?? false;
                                                                return (
                                                                    <label
                                                                        key={p.key}
                                                                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                                                                    >
                                                                        <div className="text-sm">{p.label}</div>
                                                                        <Checkbox
                                                                            checked={checked}
                                                                            onCheckedChange={(v) =>
                                                                                setEditingRole((prev) => {
                                                                                    if (!prev) return prev;
                                                                                    const next = new Set(prev.permissions ?? []);
                                                                                    v ? next.add(p.key) : next.delete(p.key);
                                                                                    return { ...prev, permissions: [...next] };
                                                                                })
                                                                            }
                                                                            aria-label={p.label}
                                                                        />
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </details>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                            {/* Sticky footer */}
                            <DialogFooter className="sticky bottom-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t px-6 py-4">
                                <Button variant="outline" onClick={() => setEditOpen(false)}>
                                    Cancel
                                </Button>
                                <Button onClick={submitEdit}>
                                    {editingRole?.id ? "Save changes" : "Create role"}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete Confirm */}
            <Dialog
                open={confirmDelete.open}
                onOpenChange={(open) => setConfirmDelete((prev) => ({ ...prev, open }))}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete {confirmDelete.ids.length > 1 ? "roles" : "role"}?</DialogTitle>
                        <DialogDescription className="text-red-600 dark:text-red-400">
                            This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="text-sm">
                        Deleting a role will remove it permanently. Roles in use or protected roles cannot be deleted.
                    </div>
                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setConfirmDelete({ open: false, ids: [] })}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={confirmPerformDelete}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Export dialog (unchanged) */}
            <Dialog open={exportOpen} onOpenChange={(v) => setExportOpen(v)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Export roles</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        {/* Scope (radio) */}
                        <div className="rounded-md border p-3">
                            <div className="font-medium mb-2 text-sm">Scope</div>
                            <RadioGroup
                                value={exportScope}
                                onValueChange={(v: "selected" | "filtered" | "all") => setExportScope(v)}
                                className="grid gap-2 sm:grid-cols-3"
                            >
                                {(["selected", "filtered", "all"] as const).map((s) => (
                                    <label
                                        key={s}
                                        className={cn(
                                            "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
                                            exportScope === s && "border-primary"
                                        )}
                                    >
                                        <span className="capitalize">{s}</span>
                                        <RadioGroupItem value={s} aria-label={`Export scope ${s}`} />
                                    </label>
                                ))}
                            </RadioGroup>
                        </div>

                        {/* Columns (checkboxes) */}
                        <div className="rounded-md border p-3">
                            <div className="font-medium mb-2 text-sm">Columns</div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((k) => (
                                    <label
                                        key={k}
                                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                                    >
                                        <span>{COLUMN_LABELS[k]}</span>
                                        <Checkbox
                                            checked={exportColumns.includes(k)}
                                            onCheckedChange={(v) =>
                                                setExportColumns((prev) => {
                                                    const set = new Set(prev);
                                                    v ? set.add(k) : set.delete(k);
                                                    return [...set];
                                                })
                                            }
                                            aria-label={`Column ${COLUMN_LABELS[k]}`}
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Format (radio) */}
                        <div className="rounded-md border p-3">
                            <div className="font-medium mb-2 text-sm">Format</div>
                            <RadioGroup
                                value={exportFormat}
                                onValueChange={(v: "xlsx" | "csv") => setExportFormat(v)}
                                className="grid gap-2 sm:grid-cols-2"
                            >
                                {(["xlsx", "csv"] as const).map((fmt) => (
                                    <label
                                        key={fmt}
                                        className={cn(
                                            "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
                                            exportFormat === fmt && "border-primary"
                                        )}
                                    >
                                        <span className="uppercase">{fmt}</span>
                                        <RadioGroupItem value={fmt} aria-label={`Format ${fmt}`} />
                                    </label>
                                ))}
                            </RadioGroup>
                        </div>
                    </div>

                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setExportOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={doExport}>
                            <Download className="h-4 w-4 mr-2" />
                            Export
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </TabsContent>
    );
}

/* ========= Row actions ========= */
function RowActions({
    role,
    onEdit,
    onDuplicate,
    onDelete,
}: {
    role: Role;
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const deletable = !isProtectedRoleName(role.name) && (role.usersCount ?? 0) === 0;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open actions">
                    <MoreVertical className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                    <DropdownMenuShortcut>E</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={!deletable}
                    onClick={deletable ? onDelete : undefined}
                    title={
                        deletable
                            ? "Delete role"
                            : isProtectedRoleName(role.name)
                                ? "Protected role cannot be deleted"
                                : "Role has users; reassign them first"
                    }
                    className={cn(!deletable && "opacity-60")}
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
