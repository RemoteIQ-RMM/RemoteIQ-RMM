// app/administration/tabs/UsersTab.tsx
"use client";

import * as React from "react";
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
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
import { Badge } from "@/components/ui/badge";
import {
    UserPlus,
    Trash2,
    Search,
    Lock,
    Shield,
    MoreVertical,
    ArrowUpDown,
    Download,
    Filter,
    Upload,
    Link as LinkIcon,
    Plus,
    UserCog,
    Power,
    Copy as CopyIcon,
    Settings as SettingsIcon,
    RefreshCw,
    Eye,       // ← added
    EyeOff,    // ← added
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Role, User } from "../types";
import type { ToastFn } from "../types";

import {
    inviteUsers,
    updateUserRole as apiUpdateUserRole,
    resetUser2FA as apiResetUser2FA,
    removeUser as apiRemoveUser,
    createAdminUser,
    setUserPassword,
    setUserSuspended,
    updateUser as apiUpdateUser,
} from "@/lib/api";

import { Workbook } from "exceljs";
import { useVirtualizer } from "@tanstack/react-virtual";

const NO_ROLE = "__none__";
const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
    return typeof v === "string" && uuidRegex.test(v);
}

const safeStr = (v: unknown) => (typeof v === "string" ? v : "");
const safeBool = (v: unknown) => (typeof v === "boolean" ? v : false);

type RoleSummary = { id: string; name: string };

const normalizeRoleSummaries = (roles: unknown): RoleSummary[] => {
    if (!Array.isArray(roles)) return [];
    return roles
        .map((r) => ({
            id: typeof r?.id === "string" ? r.id : null,
            name: typeof r?.name === "string" ? r.name.trim() : "",
        }))
        .filter((r): r is RoleSummary => Boolean(r.id) && Boolean(r.name));
};

const getPrimaryRoleId = (u: Partial<User>): string | null => {
    const direct = typeof (u as any)?.roleId === "string" ? ((u as any).roleId as string) : null;
    if (direct && direct.length) return direct;
    const roles = normalizeRoleSummaries((u as any)?.roles);
    if (roles.length > 0) return roles[0].id;
    return null;
};

const getPrimaryRoleName = (u: Partial<User>): string => {
    const direct = safeStr((u as any)?.role);
    if (direct) return direct;
    const roles = normalizeRoleSummaries((u as any)?.roles);
    return roles.length > 0 ? roles[0].name : "";
};

const userHasRoleFilter = (u: Partial<User>, filter: string): boolean => {
    if (filter === NO_ROLE) {
        return !getPrimaryRoleId(u) && !getPrimaryRoleName(u);
    }
    const directId = getPrimaryRoleId(u);
    if (directId && directId === filter) return true;
    const summaries = normalizeRoleSummaries((u as any)?.roles);
    if (summaries.some((r) => r.id === filter || r.name === filter)) return true;
    const directName = getPrimaryRoleName(u);
    return Boolean(directName) && directName === filter;
};

const updateUserRoleMetadata = (user: User, roleId: string | null, catalog: Role[]): User => {
    if (!roleId) {
        return {
            ...user,
            role: "",
            roleId: null,
            roles: [],
        };
    }

    const catalogMatch = catalog.find((r) => r.id === roleId);
    const name = catalogMatch?.name ?? getPrimaryRoleName(user);
    return {
        ...user,
        role: name,
        roleId,
        roles: catalogMatch ? [{ id: catalogMatch.id, name: catalogMatch.name }] : user.roles,
    };
};

const resolveRoleSelection = (
    value: string | undefined,
    catalog: Role[],
): { id: string | null; name: string } => {
    if (!value || value === NO_ROLE) return { id: null, name: "" };
    if (isUuid(value)) {
        const match = catalog.find((r) => r.id === value);
        return { id: value, name: match?.name ?? "" };
    }
    const match = catalog.find((r) => r.name === value);
    return { id: match?.id ?? null, name: match?.name ?? value };
};

type SortKey = "name" | "email" | "role" | "lastSeen";
type SortDir = "asc" | "desc";

const PAGE_SIZES = [10, 25, 50, 100] as const;

/** Treat DB status=disabled as Suspended in the UI */
function getStatus(u: Partial<User>) {
    const st = (u as any).status as string | undefined;
    if (st === "disabled" || st === "suspended" || (u as any).suspended) return "suspended";
    if (st === "invited") return "invited";
    return "active";
}
type StatusFilter = "all" | "active" | "suspended" | "invited";

// CSV helper date (kept for potential custom date fields)
const formatIsoDate = (raw?: string) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

interface UsersTabProps {
    users: User[];
    setUsers: React.Dispatch<React.SetStateAction<User[]>>;
    roles: Role[];
    push: ToastFn;
    setRemoveUserId: (id: string | null) => void; // kept for compatibility, not used anymore
    setReset2FAUserId: (id: string | null) => void; // legacy prop; no longer needed
    setInviteOpen: (open: boolean) => void;
    refetchUsers?: () => Promise<void>;
    /** Optional localization from Localization tab */
    localization?: {
        language: string;
        dateFormat: string;
        timeZone: string;
    };
}

/** Format a date-only string using provided localization (fallbacks included) */
function formatDateOnly(
    iso: string,
    loc?: { language: string; dateFormat: string; timeZone: string }
): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";

    const tz = loc?.timeZone;
    const lang = loc?.language;
    const fmt = (loc?.dateFormat || "").toUpperCase();

    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(d);
    const dict = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const y = dict.year,
        m = dict.month,
        day = dict.day;

    switch (fmt) {
        case "MM/DD/YYYY":
            return `${m}/${day}/${y}`;
        case "DD/MM/YYYY":
            return `${day}/${m}/${y}`;
        case "YYYY-MM-DD":
            return `${y}-${m}-${day}`;
        default:
            return new Intl.DateTimeFormat(lang || undefined, {
                timeZone: tz,
                dateStyle: "medium",
            }).format(d);
    }
}

/** Column config for export (and future column-pickers) */
type ColumnKey =
    | "id"
    | "name"
    | "email"
    | "role"
    | "twoFactorEnabled"
    | "suspended"
    | "status"
    | "lastSeen"
    | "phone"
    | "address1"
    | "address2"
    | "city"
    | "state"
    | "postal"
    | "country";

const ALL_COLUMNS: {
    key: ColumnKey;
    label: string;
    getter: (u: User, loc?: UsersTabProps["localization"]) => string;
}[] = [
        { key: "id", label: "ID", getter: (u) => safeStr((u as any).id) },
        { key: "name", label: "Name", getter: (u) => safeStr((u as any).name) },
        { key: "email", label: "Email", getter: (u) => safeStr((u as any).email) },
        { key: "role", label: "Role", getter: (u) => getPrimaryRoleName(u) },
        {
            key: "twoFactorEnabled",
            label: "2FA Enabled",
            getter: (u) => (safeBool((u as any).twoFactorEnabled) ? "true" : "false"),
        },
        {
            key: "suspended",
            label: "Suspended",
            getter: (u) => (getStatus(u) === "suspended" ? "true" : "false"),
        },
        { key: "status", label: "Status", getter: (u) => safeStr((u as any).status ?? "") },
        {
            key: "lastSeen",
            label: "Last Seen (Date)",
            getter: (u, loc) => {
                const raw =
                    safeStr((u as any).lastSeen) ||
                    safeStr((u as any).updatedAt) ||
                    safeStr((u as any).createdAt);
                return raw ? formatDateOnly(raw, loc) : "";
            },
        },
        { key: "phone", label: "Phone", getter: (u) => safeStr((u as any).phone) },
        { key: "address1", label: "Address 1", getter: (u) => safeStr((u as any).address1) },
        { key: "address2", label: "Address 2", getter: (u) => safeStr((u as any).address2) },
        { key: "city", label: "City", getter: (u) => safeStr((u as any).city) },
        { key: "state", label: "State/Region", getter: (u) => safeStr((u as any).state) },
        { key: "postal", label: "Postal", getter: (u) => safeStr((u as any).postal) },
        { key: "country", label: "Country", getter: (u) => safeStr((u as any).country) },
    ];

/** Sanitize to avoid Excel/CSV formula injection */
const sanitizeCell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s;
};

/** Excel export with auto-sized columns (exceljs) */
async function exportXlsx(
    rows: User[],
    columns: ColumnKey[],
    loc?: UsersTabProps["localization"]
) {
    const cols = ALL_COLUMNS.filter((c) => columns.includes(c.key));

    const wb = new Workbook();
    const ws = wb.addWorksheet("Users");

    // Set columns with headers
    ws.columns = cols.map((c) => ({
        header: c.label,
        key: c.key,
        width: Math.max(10, c.label.length + 2),
    })) as any;

    // Add rows
    rows.forEach((u) => {
        const record: Record<string, string> = {};
        cols.forEach((c) => {
            record[c.key] = sanitizeCell(c.getter(u, loc));
        });
        ws.addRow(record);
    });

    // Auto-size columns by content
    (ws.columns || []).forEach((col: any) => {
        let max = col.header ? String(col.header).length : 10;
        col.eachCell({ includeEmpty: true }, (cell: any) => {
            const v = cell.value == null ? "" : String(cell.value);
            if (v.length > max) max = v.length;
        });
        col.width = Math.min(Math.max(max + 2, 8), 60);
    });

    // Download
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users.xlsx";
    a.click();
    URL.revokeObjectURL(url);
}

/** CSV export (custom columns + scope) */
function exportCsv(
    rows: User[],
    columns: ColumnKey[],
    loc?: UsersTabProps["localization"]
) {
    const cols = ALL_COLUMNS.filter((c) => columns.includes(c.key));
    const headers = cols.map((c) => c.label).join(",");
    const lines = rows.map((u) =>
        cols
            .map((c) => {
                const v = sanitizeCell(c.getter(u, loc));
                const needsQuote = /[",\n]/.test(v);
                const escaped = v.replaceAll('"', '""');
                return needsQuote ? `"${escaped}"` : escaped;
            })
            .join(",")
    );
    const blob = new Blob([headers + "\n" + lines.join("\n")], {
        type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "users.csv";
    a.click();
    URL.revokeObjectURL(url);
}

export default function UsersTab({
    users,
    setUsers,
    roles,
    push,
    setRemoveUserId, // kept but unused (replaced by local confirm dialog)
    setReset2FAUserId, // legacy prop; no longer used
    setInviteOpen,
    refetchUsers,
    localization,
}: UsersTabProps) {
    /** Loading / sync state */
    const [syncing, setSyncing] = React.useState(false);
    const refreshFromServer = React.useCallback(
        async (toastOnSuccess = false) => {
            if (!refetchUsers) return;
            setSyncing(true);
            try {
                await refetchUsers();
                if (toastOnSuccess) push({ title: "Users synced", kind: "success" });
            } catch (e: any) {
                push({
                    title: "Refresh failed",
                    desc: e?.message ?? "Request failed",
                    kind: "destructive",
                });
            } finally {
                setSyncing(false);
            }
        },
        [refetchUsers, push]
    );

    /** Filters/search/sort/pagination */
    const [rawQuery, setRawQuery] = React.useState("");
    const [query, setQuery] = React.useState("");
    const [roleFilter, setRoleFilter] = React.useState<string>("all");
    const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
    const [sortKey, setSortKey] = React.useState<SortKey>("name");
    const [sortDir, setSortDir] = React.useState<SortDir>("asc");
    const [pageSize, setPageSize] = React.useState<(typeof PAGE_SIZES)[number]>(25);
    const [page, setPage] = React.useState(1);

    /** Selection state for bulk actions */
    const [selected, setSelected] = React.useState<Record<string, boolean>>({});

    /** Invite modals */
    const [inviteOpen, setInviteOpenLocal] = React.useState(false);
    const [bulkInviteOpen, setBulkInviteOpen] = React.useState(false);

    /** Create / Password / Edit modals */
    const [createOpen, setCreateOpen] = React.useState(false);
    const [pwdUserId, setPwdUserId] = React.useState<string | null>(null);
    const [editUser, setEditUser] = React.useState<User | null>(null);

    /** Remove user confirmation (new) */
    const [removeDialogUser, setRemoveDialogUser] = React.useState<User | null>(null);
    const [removing, setRemoving] = React.useState(false);

    /** Export config dialog */
    const [exportOpen, setExportOpen] = React.useState(false);
    const [exportFormat, setExportFormat] = React.useState<"xlsx" | "csv">("xlsx");
    const [exportScope, setExportScope] = React.useState<"selected" | "filtered" | "all">(
        "filtered"
    );
    const [exportColumns, setExportColumns] = React.useState<ColumnKey[]>(
        ALL_COLUMNS.map((c) => c.key)
    );

    /** Virtualization */
    const [virtualize, setVirtualize] = React.useState(false);
    const tableParentRef = React.useRef<HTMLDivElement | null>(null);

    /** Per-row busy state for actions */
    const [busyRow, setBusyRow] = React.useState<Record<string, boolean>>({});

    /** Debounce search input */
    React.useEffect(() => {
        const t = setTimeout(() => setQuery(rawQuery.trim().toLowerCase()), 180);
        return () => clearTimeout(t);
    }, [rawQuery]);

    React.useEffect(() => {
        setSelected({});
    }, [users]);

    const filtered = React.useMemo(() => {
        let list = users.slice();

        if (query) {
            list = list.filter(
                (u) =>
                    safeStr(u.name).toLowerCase().includes(query) ||
                    safeStr(u.email).toLowerCase().includes(query)
            );
        }

        if (roleFilter !== "all") {
            list = list.filter((u) => userHasRoleFilter(u, roleFilter));
        }

        if (statusFilter !== "all") {
            list = list.filter((u) => getStatus(u) === statusFilter);
        }

        list.sort((a, b) => {
            const getStr = (x: any, key: SortKey) =>
                key === "name"
                    ? safeStr(x.name)
                    : key === "email"
                        ? safeStr(x.email)
                        : key === "role"
                            ? getPrimaryRoleName(x)
                            : safeStr(x.lastSeen ?? "");

            if (sortKey === "lastSeen") {
                const ta = Date.parse(
                    (a as any).lastSeen || (a as any).updatedAt || (a as any).createdAt || 0
                );
                const tb = Date.parse(
                    (b as any).lastSeen || (b as any).updatedAt || (b as any).createdAt || 0
                );
                return sortDir === "asc" ? ta - tb : tb - ta;
            }

            const av = getStr(a, sortKey);
            const bv = getStr(b, sortKey);
            return sortDir === "asc"
                ? av.localeCompare(bv, undefined, { sensitivity: "base" })
                : bv.localeCompare(av, undefined, { sensitivity: "base" });
        });

        return list;
    }, [users, query, roleFilter, statusFilter, sortKey, sortDir]);

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const pageSafe = Math.min(page, totalPages);
    const start = (pageSafe - 1) * pageSize;
    const current = filtered.slice(start, start + pageSize);

    const toggleSort = (key: SortKey) => {
        if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else {
            setSortKey(key);
            setSortDir("asc");
        }
    };

    const allOnPageSelected =
        (virtualize ? filtered : current).length > 0 &&
        (virtualize ? filtered : current).every((u) => selected[u.id ?? ""] === true);

    const toggleSelectAllPage = (on: boolean) => {
        const next = { ...selected };
        (virtualize ? filtered : current).forEach((u) => {
            if (u.id) next[u.id] = on;
        });
        setSelected(next);
    };

    const clearSelection = () => setSelected({});

    const selectedIds = React.useMemo(
        () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
        [selected]
    );

    const roleToSelectValue = (user: Partial<User>) => {
        const primaryId = getPrimaryRoleId(user);
        if (primaryId) return primaryId;
        const name = getPrimaryRoleName(user);
        return name && name.length > 0 ? name : NO_ROLE;
    };

    const updateRole = async (userId: string, roleSelection: string) => {
        if (!isUuid(userId)) {
            push({
                title: "Invalid user id",
                desc: "Cannot update role for a user without a valid id.",
                kind: "destructive",
            });
            return;
        }
        const resolved = resolveRoleSelection(roleSelection, roles);
        const roleToSend = roleSelection === NO_ROLE ? "" : resolved.id ?? roleSelection;
        try {
            await apiUpdateUserRole(userId, roleToSend);
            setUsers((prev) =>
                prev.map((u) => {
                    if (u.id !== userId) return u;
                    if (roleSelection === NO_ROLE) {
                        return updateUserRoleMetadata(u, null, roles);
                    }
                    if (resolved.id) {
                        return updateUserRoleMetadata(u, resolved.id, roles);
                    }
                    return {
                        ...u,
                        role: resolved.name || roleToSend,
                        roleId: null,
                        roles: resolved.name
                            ? [{ id: roleToSend, name: resolved.name }]
                            : u.roles,
                    };
                })
            );
            push({ title: "Role updated", kind: "success" });
            await refreshFromServer(false);
        } catch (e: any) {
            push({
                title: "Failed to update role",
                desc: e?.message,
                kind: "destructive",
            });
        }
    };

    const bulkRemove = async () => {
        if (selectedIds.length === 0) return;
        try {
            await Promise.all(selectedIds.map((id) => apiRemoveUser(id)));
            setUsers((prev) => prev.filter((u) => !selectedIds.includes(u.id)));
            clearSelection();
            push({
                title: `Removed ${selectedIds.length} user${selectedIds.length > 1 ? "s" : ""}`,
                kind: "success",
            });
            await refreshFromServer(false);
        } catch (e: any) {
            push({
                title: "Failed to remove some users",
                desc: e?.message,
                kind: "destructive",
            });
        }
    };

    const bulkReset2FA = async () => {
        if (selectedIds.length === 0) return;
        try {
            await Promise.all(selectedIds.map((id) => apiResetUser2FA(id)));
            // Optimistically mark 2FA as disabled for selected
            setUsers((prev) =>
                prev.map((u) =>
                    u.id && selectedIds.includes(u.id)
                        ? ({ ...u, twoFactorEnabled: false } as User)
                        : u
                )
            );
        } catch (e: any) {
            push({
                title: "Failed to reset 2FA for some users",
                desc: e?.message,
                kind: "destructive",
            });
        } finally {
            clearSelection();
            push({ title: `2FA reset for ${selectedIds.length}`, kind: "success" });
            await refreshFromServer(false);
        }
    };

    /** ---- INVITE HELPERS ---- */
    async function sendInvites(payload: {
        invites: Array<{ name?: string; email: string; role?: string; message?: string }>;
    }) {
        try {
            const res = await inviteUsers(
                payload.invites.map((i) => ({
                    ...i,
                    role: i.role === NO_ROLE ? undefined : i.role,
                }))
            );

            const rawCreated = (res as any)?.created ?? [];
            const invalidCount = rawCreated.filter((i: any) => !isUuid(i?.id)).length;
            const created = rawCreated.filter((i: any) => isUuid(i?.id));

            if (invalidCount > 0) {
                push({
                    title: "Some invites returned no id",
                    desc: `${invalidCount} entr${invalidCount === 1 ? "y" : "ies"} skipped until the server returns real IDs.`,
                    kind: "warning",
                });
            }

            const createdUsers: User[] = created.map((i: any) => {
                const serverSummaries = normalizeRoleSummaries(i.roles);
                const primaryRoleId =
                    typeof i.roleId === "string" && i.roleId.length
                        ? i.roleId
                        : serverSummaries[0]?.id ?? null;
                const primaryRoleName = safeStr(i.role) || serverSummaries[0]?.name || "";
                const fallback = resolveRoleSelection(primaryRoleId ?? i.role, roles);
                const summaries = serverSummaries.length
                    ? serverSummaries
                    : fallback.id && fallback.name
                        ? [{ id: fallback.id, name: fallback.name }]
                        : [];

                return {
                    id: i.id,
                    name: i.name,
                    email: i.email,
                    role: primaryRoleName || fallback.name,
                    roleId: primaryRoleId ?? fallback.id ?? null,
                    roles: summaries,
                    status: i.status ?? "invited",
                    twoFactorEnabled: Boolean(i.twoFactorEnabled ?? false),
                    lastSeen: i.lastSeen ?? "",
                    createdAt: i.createdAt ?? new Date().toISOString(),
                    updatedAt: i.updatedAt ?? new Date().toISOString(),
                };
            });

            if (createdUsers.length > 0) {
                // optimistic add, then authoritative refresh
                setUsers((prev) => [...createdUsers, ...prev]);
                push({
                    title: `Invitation${createdUsers.length > 1 ? "s" : ""} sent`,
                    desc: `${createdUsers.length} recipient${createdUsers.length > 1 ? "s" : ""}`,
                    kind: "success",
                });
                await refreshFromServer(false);
            }
        } catch (e: any) {
            const newUsers: User[] = payload.invites.map((i) => {
                const meta = resolveRoleSelection(i.role, roles);
                return {
                    id: crypto.randomUUID(),
                    name: i.name || i.email.split("@")[0],
                    email: i.email,
                    role: meta.name,
                    roleId: meta.id,
                    roles: meta.id && meta.name ? [{ id: meta.id, name: meta.name }] : [],
                    // @ts-ignore
                    status: "invited",
                    // @ts-ignore
                    twoFactorEnabled: false,
                    // @ts-ignore
                    suspended: false,
                    // @ts-ignore
                    lastSeen: "",
                };
            });
            setUsers((prev) => [...newUsers, ...prev]);
            push({
                title: `Invites queued (offline)`,
                desc: (e?.message as string) || "Backend not reachable—optimistic add only.",
                kind: "warning",
            });
        }
    }

    const copyGenericInviteLink = async () => {
        const link = `${location.origin}/invite/join`;
        await navigator.clipboard.writeText(link);
        push({ title: "Invite link copied", desc: link, kind: "success" });
    };

    const handleSuspendToggle = async (u: User) => {
        if (!isUuid(u.id)) {
            push({
                title: "Invalid user id",
                desc: "Cannot update status without a valid id.",
                kind: "destructive",
            });
            return;
        }
        const suspending = getStatus(u) !== "suspended";
        const id = u.id;

        // optimistic UI (we keep using "suspended" in the UI; backend stores "disabled")
        // optimistic — write what the DB expects
        setUsers((prev) =>
            prev.map((x) =>
                x.id === id ? { ...x, status: suspending ? "disabled" : "active" } : x
            )
        );

        setBusyRow((b) => ({ ...b, [id]: true }));
        try {
            await setUserSuspended(id, suspending);
            push({
                title: suspending ? "User suspended" : "User unsuspended",
                kind: "success",
            });
            await refreshFromServer(false);
        } catch (e: any) {
            // revert on failure
            setUsers((prev) =>
                prev.map((x) =>
                    x.id === id ? { ...x, status: suspending ? "active" : "disabled" } : x
                )
            );

            push({
                title: "Failed to update status",
                desc: e?.message,
                kind: "destructive",
            });
        } finally {
            setBusyRow((b) => ({ ...b, [id]: false }));
        }
    };

    /** ====== Export helpers ====== */
    const datasetByScope = React.useCallback(
        (scope: "selected" | "filtered" | "all") => {
            if (scope === "selected" && selectedIds.length > 0) {
                const set = new Set(selectedIds);
                return users.filter((u) => u.id && set.has(u.id));
            }
            if (scope === "all") return users;
            return filtered; // "filtered"
        },
        [users, filtered, selectedIds]
    );

    const runExport = async () => {
        const rows = datasetByScope(exportScope);
        if (rows.length === 0) {
            push({ title: "Nothing to export", kind: "warning" });
            return;
        }
        if (exportFormat === "xlsx") {
            await exportXlsx(rows, exportColumns, localization);
        } else {
            exportCsv(rows, exportColumns, localization);
        }
        setExportOpen(false);
    };

    const copyEmails = async () => {
        const rows =
            selectedIds.length > 0
                ? datasetByScope("selected")
                : datasetByScope("filtered");
        const emails = rows.map((u) => safeStr((u as any).email)).filter(Boolean);
        if (emails.length === 0) {
            push({ title: "No emails found", kind: "warning" });
            return;
        }
        await navigator.clipboard.writeText(emails.join("\n"));
        push({ title: `Copied ${emails.length} email${emails.length > 1 ? "s" : ""}`, kind: "success" });
    };

    // Virtualizer (only when enabled; uses filtered rows, ignores pagination)
    const rowVirtualizer = useVirtualizer({
        count: virtualize ? filtered.length : 0,
        getScrollElement: () => tableParentRef.current,
        estimateSize: () => 48, // row height estimate
        overscan: 12,
    });
    const virtualItems = virtualize ? rowVirtualizer.getVirtualItems() : [];

    /** ====== UI ====== */
    return (
        <TabsContent value="users" className="mt-0">
            <Card>
                <CardHeader>
                    <CardTitle>User Management</CardTitle>
                    <CardDescription>
                        Invite, create, search, filter, and manage members. Bulk actions make it easy to operate at scale.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative w-64">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    aria-label="Search users"
                                    value={rawQuery}
                                    onChange={(e) => {
                                        setRawQuery(e.target.value);
                                        setPage(1);
                                    }}
                                    placeholder="Search name or email…"
                                    className="pl-8"
                                />
                            </div>

                            <Filter className="h-4 w-4 text-muted-foreground" />

                            {/* Role filter */}
                            <Select
                                value={roleFilter}
                                onValueChange={(v) => {
                                    setRoleFilter(v);
                                    setPage(1);
                                }}
                            >
                                <SelectTrigger className="w-44 h-9" aria-label="Filter by role">
                                    <SelectValue placeholder="Role" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All roles</SelectItem>
                                    <SelectItem value={NO_ROLE}>(No role)</SelectItem>
                                    {roles.map((r) => (
                                        <SelectItem key={r.id} value={r.id}>
                                            {r.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {/* Status filter */}
                            <Select
                                value={statusFilter}
                                onValueChange={(v: StatusFilter) => {
                                    setStatusFilter(v);
                                    setPage(1);
                                }}
                            >
                                <SelectTrigger className="w-44 h-9" aria-label="Filter by status">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All statuses</SelectItem>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="invited">Invited</SelectItem>
                                    <SelectItem value="suspended">Suspended</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Right side: export + copy + virtualize + sync + create/invite */}
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setExportOpen(true)}
                                title="Export (configure scope & columns)"
                            >
                                <SettingsIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                                Export…
                            </Button>

                            <Button variant="outline" onClick={copyEmails} title="Copy emails (selected if any, else filtered)">
                                <CopyIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                                Copy emails
                            </Button>

                            <div className="flex items-center gap-2 border rounded-md px-2 py-1">
                                <Checkbox
                                    id="virtualize-toggle"
                                    checked={virtualize}
                                    onCheckedChange={(v) => setVirtualize(Boolean(v))}
                                />
                                <label htmlFor="virtualize-toggle" className="text-xs cursor-pointer">
                                    Virtualize (ignore pagination)
                                </label>
                            </div>

                            <Button
                                variant="outline"
                                onClick={() => refreshFromServer(true)}
                                disabled={syncing || !refetchUsers}
                                title="Sync with server"
                            >
                                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                                Sync
                            </Button>

                            <Button onClick={() => setCreateOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                                New user
                            </Button>

                            {/* Invite menu */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button>
                                        <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                                        Invite
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-60">
                                    <DropdownMenuLabel>Invite users</DropdownMenuLabel>
                                    <DropdownMenuItem onClick={() => setInviteOpenLocal(true)}>
                                        <UserPlus className="mr-2 h-4 w-4" />
                                        Invite single user
                                        <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setBulkInviteOpen(true)}>
                                        <Upload className="mr-2 h-4 w-4" />
                                        Bulk invite (paste emails)
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={copyGenericInviteLink}>
                                        <LinkIcon className="mr-2 h-4 w-4" />
                                        Copy invite link
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>

                    {/* Bulk bar */}
                    {selectedIds.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                            <div className="text-sm">
                                <strong>{selectedIds.length}</strong> selected
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={bulkReset2FA}>
                                    <Shield className="mr-2 h-4 w-4" aria-hidden="true" />
                                    Reset 2FA
                                </Button>
                                <Button variant="destructive" size="sm" onClick={bulkRemove}>
                                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                                    Remove
                                </Button>
                                <Button variant="ghost" size="sm" onClick={clearSelection}>
                                    Clear selection
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Table */}
                    <div className="rounded-md border overflow-hidden">
                        {/* Header */}
                        <div className="grid grid-cols-[40px_1.2fr_1.2fr_0.9fr_0.9fr_100px] bg-muted/30 p-2 text-xs font-medium text-muted-foreground">
                            <div className="px-2">
                                <Checkbox
                                    checked={allOnPageSelected}
                                    onCheckedChange={(v) => toggleSelectAllPage(Boolean(v))}
                                    aria-label="Select all on page"
                                />
                            </div>

                            <HeaderCell
                                label="Name"
                                active={sortKey === "name"}
                                dir={sortDir}
                                onClick={() => toggleSort("name")}
                            />
                            <HeaderCell
                                label="Email"
                                active={sortKey === "email"}
                                dir={sortDir}
                                onClick={() => toggleSort("email")}
                            />
                            <HeaderCell
                                label="Role"
                                active={sortKey === "role"}
                                dir={sortDir}
                                onClick={() => toggleSort("role")}
                            />
                            <HeaderCell
                                label="Last seen"
                                active={sortKey === "lastSeen"}
                                dir={sortDir}
                                onClick={() => toggleSort("lastSeen")}
                            />

                            <div className="px-2 text-right">Actions</div>
                        </div>

                        {/* Rows - virtualized OR paginated */}
                        {virtualize ? (
                            <div
                                ref={tableParentRef}
                                className="relative h-[600px] overflow-auto"
                            >
                                <div
                                    style={{ height: rowVirtualizer.getTotalSize() }}
                                    className="relative"
                                >
                                    {virtualItems.length === 0 && (
                                        <div className="p-8 text-center text-sm text-muted-foreground">
                                            {filtered.length === 0
                                                ? "No users match your filters."
                                                : "Loading…"}
                                        </div>
                                    )}
                                    {virtualItems.map((vi) => {
                                        const u = filtered[vi.index];
                                        const id = safeStr(u.id);
                                        const tf = safeBool((u as any).twoFactorEnabled);
                                        const status = getStatus(u);
                                        const suspended = status === "suspended";
                                        const lastSeenIso =
                                            safeStr((u as any).lastSeen) ||
                                            safeStr((u as any).updatedAt) ||
                                            safeStr((u as any).createdAt);
                                        const canEditRole = isUuid(id);

                                        const rowBusy = !!busyRow[id];

                                        return (
                                            <div
                                                key={id || vi.index}
                                                className="grid grid-cols-[40px_1.2fr_1.2fr_0.9fr_0.9fr_100px] items-center border-t p-2 gap-2"
                                                style={{
                                                    position: "absolute",
                                                    top: 0,
                                                    left: 0,
                                                    width: "100%",
                                                    transform: `translateY(${vi.start}px)`,
                                                }}
                                            >
                                                <div className="px-2">
                                                    <Checkbox
                                                        checked={selected[id] ?? false}
                                                        onCheckedChange={(v) =>
                                                            setSelected((prev) => ({
                                                                ...prev,
                                                                [id]: Boolean(v),
                                                            }))
                                                        }
                                                        aria-label={`Select ${u.name}`}
                                                    />
                                                </div>

                                                {/* Name + badges */}
                                                <div className="px-2 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <div className="truncate" title={u.name}>
                                                            {u.name}
                                                        </div>
                                                        {tf && <Badge variant="outline">2FA</Badge>}
                                                        {status === "invited" && (
                                                            <Badge variant="secondary">Invited</Badge>
                                                        )}
                                                        {suspended && (
                                                            <Badge variant="destructive">Suspended</Badge>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Email */}
                                                <div className="px-2 text-muted-foreground truncate" title={u.email}>
                                                    {u.email}
                                                </div>

                                                {/* Role */}
                                                <div className="px-2 relative z-10">
                                                    <Select
                                                        value={roleToSelectValue(u)}
                                                        onValueChange={(v) => canEditRole && updateRole(id, v)}
                                                        disabled={!canEditRole || rowBusy}
                                                    >
                                                        <SelectTrigger className="h-8" aria-label="Change role">
                                                            <SelectValue placeholder={canEditRole ? "Role" : "No id"} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value={NO_ROLE}>(No role)</SelectItem>
                                                            {roles.map((r) => (
                                                                <SelectItem key={r.id} value={r.id}>
                                                                    {r.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                {/* Last seen */}
                                                <div className="px-2 text-muted-foreground truncate" title={lastSeenIso || "No data"}>
                                                    {lastSeenIso ? formatDateOnly(lastSeenIso, localization) : "—"}
                                                </div>

                                                {/* Actions */}
                                                <div className="px-2 flex items-center justify-end gap-1">
                                                    <RowActions
                                                        disabled={rowBusy}
                                                        onEdit={() => setEditUser(u)}
                                                        onResetPassword={() => setPwdUserId(isUuid(id) ? id : null)}
                                                        onReset2FA={async () => {
                                                            if (!isUuid(id)) {
                                                                push({ title: "Invalid user id", kind: "destructive" });
                                                                return;
                                                            }
                                                            setBusyRow((b) => ({ ...b, [id]: true }));
                                                            try {
                                                                push({ title: "Resetting 2FA…", kind: "default" });
                                                                await apiResetUser2FA(id);
                                                                push({ title: "2FA reset", kind: "success" });
                                                                await refreshFromServer(false);
                                                            } catch (e: any) {
                                                                push({ title: "Failed to reset 2FA", desc: e?.message, kind: "destructive" });
                                                            } finally {
                                                                setBusyRow((b) => ({ ...b, [id]: false }));
                                                            }
                                                        }}
                                                        onSuspendToggle={() => handleSuspendToggle(u)}
                                                        suspended={suspended}
                                                        onRemove={() => setRemoveDialogUser(u)}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : current.length === 0 ? (
                            <div className="p-8 text-center text-sm text-muted-foreground">
                                {users.length === 0
                                    ? "No users yet. Create or invite your first teammate."
                                    : "No users match your filters."}
                            </div>
                        ) : (
                            current.map((u) => {
                                const id = safeStr(u.id);
                                const tf = safeBool((u as any).twoFactorEnabled);
                                const status = getStatus(u);
                                const suspended = status === "suspended";
                                const lastSeenIso =
                                    safeStr((u as any).lastSeen) ||
                                    safeStr((u as any).updatedAt) ||
                                    safeStr((u as any).createdAt);
                                const canEditRole = isUuid(id);
                                const roleSummaries = normalizeRoleSummaries((u as any).roles);
                                const primaryRoleId = getPrimaryRoleId(u);
                                const extraRoles = roleSummaries.filter((r, idx) =>
                                    primaryRoleId ? r.id !== primaryRoleId : idx > 0,
                                );
                                const rowBusy = !!busyRow[id];

                                return (
                                    <div
                                        key={id}
                                        className="grid grid-cols-[40px_1.2fr_1.2fr_0.9fr_0.9fr_100px] items-center border-t p-2 gap-2"
                                    >
                                        <div className="px-2">
                                            <Checkbox
                                                checked={selected[id] ?? false}
                                                onCheckedChange={(v) =>
                                                    setSelected((prev) => ({
                                                        ...prev,
                                                        [id]: Boolean(v),
                                                    }))
                                                }
                                                aria-label={`Select ${u.name}`}
                                            />
                                        </div>

                                        {/* Name + badges */}
                                        <div className="px-2 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <div className="truncate" title={u.name}>
                                                    {u.name}
                                                </div>
                                                {tf && <Badge variant="outline">2FA</Badge>}
                                                {status === "invited" && (
                                                    <Badge variant="secondary">Invited</Badge>
                                                )}
                                                {suspended && (
                                                    <Badge variant="destructive">Suspended</Badge>
                                                )}
                                            </div>
                                        </div>

                                        {/* Email */}
                                        <div className="px-2 text-muted-foreground truncate" title={u.email}>
                                            {u.email}
                                        </div>

                                        {/* Role */}
                                        <div className="px-2 relative z-10">
                                            <Select
                                                value={roleToSelectValue(u)}
                                                onValueChange={(v) => canEditRole && updateRole(id, v)}
                                                disabled={!canEditRole || rowBusy}
                                            >
                                                <SelectTrigger className="h-8" aria-label="Change role">
                                                    <SelectValue placeholder={canEditRole ? "Role" : "No id"} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value={NO_ROLE}>(No role)</SelectItem>
                                                    {roles.map((r) => (
                                                        <SelectItem key={r.id} value={r.id}>
                                                            {r.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            {extraRoles.length > 0 && (
                                                <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                                                    {extraRoles.map((r) => (
                                                        <Badge key={r.id} variant="outline">
                                                            {r.name}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Last seen */}
                                        <div className="px-2 text-muted-foreground truncate" title={lastSeenIso || "No data"}>
                                            {lastSeenIso ? formatDateOnly(lastSeenIso, localization) : "—"}
                                        </div>

                                        {/* Actions */}
                                        <div className="px-2 flex items-center justify-end gap-1">
                                            <RowActions
                                                disabled={rowBusy}
                                                onEdit={() => setEditUser(u)}
                                                onResetPassword={() => setPwdUserId(isUuid(id) ? id : null)}
                                                onReset2FA={async () => {
                                                    if (!isUuid(id)) {
                                                        push({ title: "Invalid user id", kind: "destructive" });
                                                        return;
                                                    }
                                                    setBusyRow((b) => ({ ...b, [id]: true }));
                                                    try {
                                                        push({ title: "Resetting 2FA…", kind: "default" });
                                                        await apiResetUser2FA(id);
                                                        push({ title: "2FA reset", kind: "success" });
                                                        await refreshFromServer(false);
                                                    } catch (e: any) {
                                                        push({ title: "Failed to reset 2FA", desc: e?.message, kind: "destructive" });
                                                    } finally {
                                                        setBusyRow((b) => ({ ...b, [id]: false }));
                                                    }
                                                }}
                                                onSuspendToggle={() => handleSuspendToggle(u)}
                                                suspended={suspended}
                                                onRemove={() => setRemoveDialogUser(u)}
                                            />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer: pagination (hidden when virtualized) */}
                    {!virtualize && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-muted-foreground">
                                Showing <strong>{current.length}</strong> of <strong>{total}</strong>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Rows:</span>
                                    <Select
                                        value={String(pageSize)}
                                        onValueChange={(v) => {
                                            setPageSize(Number(v) as (typeof PAGE_SIZES)[number]);
                                            setPage(1);
                                        }}
                                    >
                                        <SelectTrigger className="w-[88px] h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PAGE_SIZES.map((n) => (
                                                <SelectItem key={n} value={String(n)}>
                                                    {n}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(1)}
                                        disabled={pageSafe === 1}
                                    >
                                        «
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        disabled={pageSafe === 1}
                                    >
                                        ‹
                                    </Button>
                                    <div className="px-2 text-sm min-w-[80px] text-center">
                                        Page {pageSafe} / {totalPages}
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                        disabled={pageSafe === totalPages}
                                    >
                                        ›
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(totalPages)}
                                        disabled={pageSafe === totalPages}
                                    >
                                        »
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* subtle syncing indicator */}
                    {syncing && (
                        <div className="text-xs text-muted-foreground flex items-center gap-2 pl-1">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            Syncing…
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Create User Modal */}
            <CreateUserDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                roles={roles}
                onSubmit={async (form) => {
                    try {
                        const { id } = await createAdminUser({
                            name: form.name,
                            email: form.email,
                            role: form.role === NO_ROLE ? undefined : form.role,
                            password: form.password,
                            status: "active",
                        });

                        const roleMeta = resolveRoleSelection(form.role, roles);

                        // optimistic add
                        setUsers((prev) => [
                            {
                                id,
                                name: form.name,
                                email: form.email,
                                role: roleMeta.name,
                                roleId: roleMeta.id,
                                roles:
                                    roleMeta.id && roleMeta.name
                                        ? [{ id: roleMeta.id, name: roleMeta.name }]
                                        : [],
                                // @ts-ignore
                                status: "active",
                                // @ts-ignore
                                twoFactorEnabled: false,
                                // @ts-ignore
                                suspended: false,
                                // @ts-ignore
                                lastSeen: "",
                            } as unknown as User,
                            ...prev,
                        ]);

                        push({ title: "User created", kind: "success" });
                        setCreateOpen(false);
                        await refreshFromServer(false);
                    } catch (e: any) {
                        push({
                            title: "Failed to create user",
                            desc: e?.message,
                            kind: "destructive",
                        });
                    }
                }}
            />

            {/* Set Password Modal */}
            <SetPasswordDialog
                open={!!pwdUserId}
                onOpenChange={(o) => {
                    if (!o) setPwdUserId(null);
                }}
                onSubmit={async (password) => {
                    const id = pwdUserId;
                    if (!id || !isUuid(id)) {
                        push({
                            title: "Invalid user id",
                            desc: "Cannot set password without a valid id.",
                            kind: "destructive",
                        });
                        return;
                    }
                    try {
                        await setUserPassword(id, password);
                        push({ title: "Password updated", kind: "success" });
                        setPwdUserId(null);
                    } catch (e: any) {
                        push({
                            title: "Failed to set password",
                            desc: e?.message,
                            kind: "destructive",
                        });
                    }
                }}
            />

            {/* Edit User Modal */}
            <EditUserDialog
                open={!!editUser}
                onOpenChange={(o) => {
                    if (!o) setEditUser(null);
                }}
                user={editUser}
                roles={roles}
                onSubmit={async (form) => {
                    if (!editUser || !isUuid(editUser.id)) {
                        push({
                            title: "Invalid user id",
                            desc: "Cannot edit without a valid id.",
                            kind: "destructive",
                        });
                        return;
                    }
                    const userId = editUser.id;

                    // Build a raw patch, then strip undefined/empty-string
                    const rawPatch: Partial<User> = {
                        name: form.name,
                        email: form.email,
                        role: form.role === NO_ROLE ? undefined : form.role,
                        phone: form.phone,
                        address1: form.address1,
                        address2: form.address2,
                        city: form.city,
                        state: form.state,
                        postal: form.postal,
                        country: form.country,
                    };
                    const payload = Object.fromEntries(
                        Object.entries(rawPatch).filter(
                            ([, v]) => v !== undefined && String(v).trim() !== ""
                        )
                    ) as Partial<User>;

                    // optimistic
                    const resolvedRole = resolveRoleSelection(form.role, roles);
                    const removingRole = form.role === NO_ROLE;
                    setUsers((prev) =>
                        prev.map((u) => {
                            if (u.id !== userId) return u;
                            const next = { ...u, ...payload } as User;
                            if (removingRole) {
                                return updateUserRoleMetadata(next, null, roles);
                            }
                            if (resolvedRole.id) {
                                return updateUserRoleMetadata(next, resolvedRole.id, roles);
                            }
                            if (resolvedRole.name) {
                                return {
                                    ...next,
                                    role: resolvedRole.name,
                                    roleId: null,
                                };
                            }
                            return next;
                        })
                    );

                    try {
                        await apiUpdateUser(userId, payload as any);
                        push({ title: "User updated", kind: "success" });
                        setEditUser(null);
                        await refreshFromServer(false);
                    } catch (e: any) {
                        push({
                            title: "Failed to update user",
                            desc: e?.message,
                            kind: "destructive",
                        });
                        // Let server refresh fix UI if needed
                        await refreshFromServer(false);
                    }
                }}
            />

            {/* Single Invite Modal */}
            <InviteSingleDialog
                open={inviteOpen}
                onOpenChange={setInviteOpenLocal}
                roles={roles}
                onSubmit={async (data) => {
                    await sendInvites({ invites: [data] });
                    setInviteOpenLocal(false);
                }}
            />

            {/* Bulk Invite Modal */}
            <InviteBulkDialog
                open={bulkInviteOpen}
                onOpenChange={setBulkInviteOpen}
                roles={roles}
                onSubmit={async (list) => {
                    await sendInvites({ invites: list });
                    setBulkInviteOpen(false);
                }}
            />

            {/* Export Config Dialog */}
            <Dialog open={exportOpen} onOpenChange={setExportOpen}>
                <DialogContent className="sm:max-w-[720px]">
                    <DialogHeader>
                        <DialogTitle>Export users</DialogTitle>
                        <DialogDescription>
                            Choose scope, columns, and format.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-3">
                            <div className="text-sm font-medium">Scope</div>
                            <div className="space-y-2 text-sm">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="export-scope"
                                        value="selected"
                                        checked={exportScope === "selected"}
                                        onChange={() => setExportScope("selected")}
                                    />
                                    Selected ({selectedIds.length})
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="export-scope"
                                        value="filtered"
                                        checked={exportScope === "filtered"}
                                        onChange={() => setExportScope("filtered")}
                                    />
                                    Filtered ({filtered.length})
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="export-scope"
                                        value="all"
                                        checked={exportScope === "all"}
                                        onChange={() => setExportScope("all")}
                                    />
                                    All users ({users.length})
                                </label>
                            </div>

                            <div className="mt-4">
                                <div className="text-sm font-medium mb-2">Format</div>
                                <div className="space-y-2 text-sm">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="export-format"
                                            value="xlsx"
                                            checked={exportFormat === "xlsx"}
                                            onChange={() => setExportFormat("xlsx")}
                                        />
                                        Excel (.xlsx)
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            name="export-format"
                                            value="csv"
                                            checked={exportFormat === "csv"}
                                            onChange={() => setExportFormat("csv")}
                                        />
                                        CSV (.csv)
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium">Columns</div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        setExportColumns(
                                            exportColumns.length === ALL_COLUMNS.length
                                                ? []
                                                : ALL_COLUMNS.map((c) => c.key)
                                        )
                                    }
                                >
                                    {exportColumns.length === ALL_COLUMNS.length ? "Clear all" : "Select all"}
                                </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 max-h-[260px] overflow-auto pr-2">
                                {ALL_COLUMNS.map((c) => {
                                    const checked = exportColumns.includes(c.key);
                                    return (
                                        <label key={c.key} className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={checked}
                                                onCheckedChange={(v) => {
                                                    if (v) setExportColumns((prev) => [...prev, c.key]);
                                                    else setExportColumns((prev) => prev.filter((k) => k !== c.key));
                                                }}
                                            />
                                            {c.label}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setExportOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={runExport}
                            disabled={exportColumns.length === 0}
                        >
                            <Download className="mr-2 h-4 w-4" />
                            Export
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Remove User Confirm Dialog (new) */}
            <Dialog
                open={!!removeDialogUser}
                onOpenChange={(open) => {
                    if (!open) setRemoveDialogUser(null);
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove user</DialogTitle>
                        <DialogDescription>
                            This will permanently remove the user from your workspace. This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="text-sm">
                        {removeDialogUser && (
                            <>
                                <div className="font-medium">{removeDialogUser.name || "Unnamed user"}</div>
                                <div className="text-muted-foreground">{removeDialogUser.email}</div>
                            </>
                        )}
                    </div>

                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setRemoveDialogUser(null)}
                            disabled={removing}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={async () => {
                                if (!removeDialogUser) return;
                                const id = removeDialogUser.id;
                                if (!isUuid(id)) {
                                    push({
                                        title: "Invalid user id",
                                        desc: "Cannot remove a user without a valid id.",
                                        kind: "destructive",
                                    });
                                    return;
                                }
                                setRemoving(true);
                                try {
                                    await apiRemoveUser(id);
                                    setUsers((prev) => prev.filter((u) => u.id !== id));
                                    push({ title: "User removed", kind: "success" });
                                    setRemoveDialogUser(null);
                                    await refreshFromServer(false);
                                } catch (e: any) {
                                    push({
                                        title: "Failed to remove user",
                                        desc: e?.message,
                                        kind: "destructive",
                                    });
                                } finally {
                                    setRemoving(false);
                                }
                            }}
                            disabled={removing}
                        >
                            {removing ? "Removing…" : "Remove user"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </TabsContent>
    );
}

function HeaderCell({
    label,
    active,
    dir,
    onClick,
}: {
    label: string;
    active: boolean;
    dir: "asc" | "desc";
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            className="px-2 inline-flex items-center gap-1 text-left"
            onClick={onClick}
            aria-pressed={active}
            aria-label={`Sort by ${label}`}
            title={`Sort by ${label}`}
        >
            <span>{label}</span>
            <ArrowUpDown
                className={`h-3.5 w-3.5 ${active ? "opacity-100" : "opacity-40"}`}
                aria-hidden="true"
            />
            <span className="sr-only">
                {dir === "asc" ? "ascending" : "descending"}
            </span>
        </button>
    );
}

function RowActions({
    onEdit,
    onResetPassword,
    onReset2FA,
    onSuspendToggle,
    suspended,
    onRemove,
    disabled,
}: {
    onEdit: () => void;
    onResetPassword: () => void;
    onReset2FA: () => void;
    onSuspendToggle: () => void;
    suspended: boolean;
    onRemove: () => void;
    disabled?: boolean;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open actions" disabled={disabled}>
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>

                <DropdownMenuItem onClick={onEdit} disabled={disabled}>
                    <UserCog className="mr-2 h-4 w-4" />
                    Edit user
                </DropdownMenuItem>

                <DropdownMenuItem onClick={onResetPassword} disabled={disabled}>
                    <Lock className="mr-2 h-4 w-4" />
                    Set password
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onReset2FA} disabled={disabled}>
                    <Shield className="mr-2 h-4 w-4" />
                    Reset 2FA
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSuspendToggle} disabled={disabled}>
                    <Power className="mr-2 h-4 w-4" />
                    {suspended ? "Unsuspend user" : "Suspend user"}
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={onRemove}
                    className="text-destructive focus:text-destructive"
                    disabled={disabled}
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove user
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/* =========================
   Create User Dialog
   ========================= */
function CreateUserDialog({
    open,
    onOpenChange,
    roles,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    roles: Role[];
    onSubmit: (data: { name: string; email: string; role?: string; password: string }) => Promise<void>;
}) {
    const [name, setName] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [role, setRole] = React.useState<string>(NO_ROLE);
    const [password, setPassword] = React.useState("");
    const [showPwd, setShowPwd] = React.useState(false); // ← added
    const [submitting, setSubmitting] = React.useState(false);

    const validEmail = /\S+@\S+\.\S+/.test(email);
    const validPwd = password.length >= 8;

    const valid =
        name.trim().length > 0 &&
        validEmail &&
        validPwd &&
        (role === NO_ROLE ? true : roles.some((r) => r.id === role));

    const handleSubmit = async () => {
        if (!valid) return;
        setSubmitting(true);
        try {
            await onSubmit({
                name: name.trim(),
                email: email.trim(),
                role: role === NO_ROLE ? undefined : role,
                password,
            });
            setName("");
            setEmail("");
            setRole(NO_ROLE);
            setPassword("");
            setShowPwd(false);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>New user</DialogTitle>
                    <DialogDescription>
                        Create a user and set their initial password.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3">
                    <div className="grid gap-1">
                        <label className="text-sm">Full name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                        {name.trim().length === 0 && (
                            <div className="text-xs text-red-600">Name is required</div>
                        )}
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Email</label>
                        <Input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@example.com"
                        />
                        {!validEmail && email && (
                            <div className="text-xs text-red-600">Enter a valid email</div>
                        )}
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Role</label>
                        <Select value={role} onValueChange={setRole}>
                            <SelectTrigger>
                                <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_ROLE}>(No role)</SelectItem>
                                {roles.map((r) => (
                                    <SelectItem key={r.id} value={r.id}>
                                        {r.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Password</label>
                        <div className="relative">
                            <Input
                                type={showPwd ? "text" : "password"}
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="At least 8 characters"
                                className="pr-10"
                            />
                            <button
                                type="button"
                                aria-label={showPwd ? "Hide password" : "Show password"}
                                onClick={() => setShowPwd((v) => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                            >
                                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                        {!validPwd && password && (
                            <div className="text-xs text-red-600">Minimum 8 characters</div>
                        )}
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!valid || submitting}>
                        {submitting ? "Creating…" : "Create user"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/* =========================
   Set Password Dialog
   ========================= */
function SetPasswordDialog({
    open,
    onOpenChange,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onSubmit: (password: string) => Promise<void>;
}) {
    const [pwd, setPwd] = React.useState("");
    const [pwd2, setPwd2] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);

    const valid = pwd.length >= 8 && pwd === pwd2;

    const handleSubmit = async () => {
        if (!valid) return;
        setSubmitting(true);
        try {
            await onSubmit(pwd);
            setPwd("");
            setPwd2("");
            onOpenChange(false);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set password</DialogTitle>
                    <DialogDescription>
                        Replace the user’s password with a new one.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3">
                    <div className="grid gap-1">
                        <label className="text-sm">New password</label>
                        <Input
                            type="password"
                            autoComplete="new-password"
                            value={pwd}
                            onChange={(e) => setPwd(e.target.value)}
                            placeholder="At least 8 characters"
                        />
                    </div>
                    <div className="grid gap-1">
                        <label className="text-sm">Confirm new password</label>
                        <Input
                            type="password"
                            autoComplete="new-password"
                            value={pwd2}
                            onChange={(e) => setPwd2(e.target.value)}
                            placeholder="Re-enter password"
                        />
                        {pwd && pwd2 && pwd !== pwd2 && (
                            <div className="text-xs text-red-600">Passwords do not match</div>
                        )}
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!valid || submitting}>
                        {submitting ? "Saving…" : "Save password"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/* =========================
   Edit User Dialog
   ========================= */
function EditUserDialog({
    open,
    onOpenChange,
    user,
    roles,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    user: User | null;
    roles: Role[];
    onSubmit: (data: {
        name: string;
        email: string;
        role: string;
        phone?: string;
        address1?: string;
        address2?: string;
        city?: string;
        state?: string;
        postal?: string;
        country?: string;
    }) => Promise<void>;
}) {
    const [name, setName] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [role, setRole] = React.useState<string>(NO_ROLE);
    const [phone, setPhone] = React.useState("");
    const [address1, setAddress1] = React.useState("");
    const [address2, setAddress2] = React.useState("");
    const [city, setCity] = React.useState("");
    const [state, setState] = React.useState("");
    const [postal, setPostal] = React.useState("");
    const [country, setCountry] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);

    React.useEffect(() => {
        if (!user) return;
        setName(user.name || "");
        setEmail(user.email || "");
        const primaryId = getPrimaryRoleId(user);
        if (primaryId) {
            setRole(primaryId);
        } else {
            const fallback = resolveRoleSelection(user.role, roles);
            setRole(fallback.id ?? NO_ROLE);
        }
        setPhone((user as any).phone || "");
        setAddress1((user as any).address1 || "");
        setAddress2((user as any).address2 || "");
        setCity((user as any).city || "");
        setState((user as any).state || "");
        setPostal((user as any).postal || "");
        setCountry((user as any).country || "");
    }, [user, roles]);

    const validEmail = /\S+@\S+\.\S+/.test(email);
    const valid =
        name.trim().length > 0 &&
        validEmail &&
        (role === NO_ROLE ? true : roles.some((r) => r.id === role));

    const handleSubmit = async () => {
        if (!valid || !user) return;
        setSubmitting(true);
        try {
            await onSubmit({
                name: name.trim(),
                email: email.trim(),
                role,
                phone: phone.trim() || undefined,
                address1: address1.trim() || undefined,
                address2: address2.trim() || undefined,
                city: city.trim() || undefined,
                state: state.trim() || undefined,
                postal: postal.trim() || undefined,
                country: country.trim() || undefined,
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[700px]">
                <DialogHeader>
                    <DialogTitle>Edit user</DialogTitle>
                    <DialogDescription>
                        Update basic profile details. Only provided fields are sent to the server.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="grid gap-1">
                        <label className="text-sm">Full name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Email</label>
                        <Input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@example.com"
                        />
                        {!validEmail && email && (
                            <div className="text-xs text-red-600">Enter a valid email</div>
                        )}
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Role</label>
                        <Select value={role} onValueChange={setRole}>
                            <SelectTrigger>
                                <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_ROLE}>(No role)</SelectItem>
                                {roles.map((r) => (
                                    <SelectItem key={r.id} value={r.id}>
                                        {r.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Phone</label>
                        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Address 1</label>
                        <Input value={address1} onChange={(e) => setAddress1(e.target.value)} />
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Address 2</label>
                        <Input value={address2} onChange={(e) => setAddress2(e.target.value)} />
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">City</label>
                        <Input value={city} onChange={(e) => setCity(e.target.value)} />
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">State / Region</label>
                        <Input value={state} onChange={(e) => setState(e.target.value)} />
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Postal code</label>
                        <Input value={postal} onChange={(e) => setPostal(e.target.value)} />
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Country</label>
                        <Input value={country} onChange={(e) => setCountry(e.target.value)} />
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!valid || submitting}>
                        {submitting ? "Saving…" : "Save changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/* =========================
   Invite Single Dialog
   ========================= */
function InviteSingleDialog({
    open,
    onOpenChange,
    roles,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    roles: Role[];
    onSubmit: (data: { name?: string; email: string; role?: string; message?: string }) => Promise<void>;
}) {
    const [name, setName] = React.useState("");
    const [email, setEmail] = React.useState("");
    const [role, setRole] = React.useState<string>(NO_ROLE);
    const [message, setMessage] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);

    const valid =
        /\S+@\S+\.\S+/.test(email) &&
        (role === NO_ROLE ? true : roles.some((r) => r.id === role));

    const handleSubmit = async () => {
        if (!valid) return;
        setSubmitting(true);
        try {
            await onSubmit({
                name: name.trim() || undefined,
                email: email.trim(),
                role: role === NO_ROLE ? undefined : role,
                message: message.trim() || undefined,
            });
            setName("");
            setEmail("");
            setRole(NO_ROLE);
            setMessage("");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Invite user</DialogTitle>
                    <DialogDescription>
                        Send a one-time invite email with a sign-up link.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3">
                    <div className="grid gap-1">
                        <label className="text-sm">Full name (optional)</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} />
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Email</label>
                        <Input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@example.com"
                        />
                        {!/\S+@\S+\.\S+/.test(email) && email && (
                            <div className="text-xs text-red-600">Enter a valid email</div>
                        )}
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Role</label>
                        <Select value={role} onValueChange={setRole}>
                            <SelectTrigger>
                                <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_ROLE}>(No role)</SelectItem>
                                {roles.map((r) => (
                                    <SelectItem key={r.id} value={r.id}>
                                        {r.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Message (optional)</label>
                        <Textarea
                            rows={4}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Welcome aboard! Here’s your invite…"
                        />
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!valid || submitting}>
                        {submitting ? "Sending…" : "Send invite"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/* =========================
   Invite Bulk Dialog
   ========================= */
function InviteBulkDialog({
    open,
    onOpenChange,
    roles,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    roles: Role[];
    onSubmit: (
        list: Array<{ name?: string; email: string; role?: string }>
    ) => Promise<void>;
}) {
    const [emailsBlock, setEmailsBlock] = React.useState("");
    const [defaultRole, setDefaultRole] = React.useState<string>(NO_ROLE);
    const [submitting, setSubmitting] = React.useState(false);

    const parsed = React.useMemo(() => {
        const out: Array<{ name?: string; email: string; role?: string }> = [];
        emailsBlock
            .split(/\r?\n|,|;/g)
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((token) => {
                const m = token.match(/^(.*)<(.+@.+\..+)>$/);
                if (m) {
                    const name = m[1].trim().replace(/^"|"$/g, "");
                    const email = m[2].trim();
                    if (/\S+@\S+\.\S+/.test(email))
                        out.push({
                            name: name || undefined,
                            email,
                            role: defaultRole === NO_ROLE ? undefined : defaultRole,
                        });
                } else if (/\S+@\S+\.\S+/.test(token)) {
                    out.push({
                        email: token,
                        role: defaultRole === NO_ROLE ? undefined : defaultRole,
                    });
                }
            });
        return out;
    }, [emailsBlock, defaultRole]);

    const handleSubmit = async () => {
        if (parsed.length === 0) return;
        setSubmitting(true);
        try {
            await onSubmit(parsed);
            setEmailsBlock("");
            setDefaultRole(NO_ROLE);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[640px]">
                <DialogHeader>
                    <DialogTitle>Bulk invite</DialogTitle>
                    <DialogDescription>
                        Paste one or more emails (comma/semicolon/newline separated). You can also use{" "}
                        <code>Name &lt;email@domain&gt;</code> format.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3">
                    <div className="grid gap-1">
                        <label className="text-sm">Default role</label>
                        <Select value={defaultRole} onValueChange={setDefaultRole}>
                            <SelectTrigger>
                                <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_ROLE}>(No role)</SelectItem>
                                {roles.map((r) => (
                                    <SelectItem key={r.id} value={r.id}>
                                        {r.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-1">
                        <label className="text-sm">Emails / CSV</label>
                        <Textarea
                            rows={8}
                            value={emailsBlock}
                            onChange={(e) => setEmailsBlock(e.target.value)}
                            placeholder={`jane@example.com
John Smith <john@acme.io>, mia@acme.io; "Alex Q." <alex@acme.io>`}
                        />
                        <div className="text-xs text-muted-foreground">
                            Parsed: <strong>{parsed.length}</strong>{" "}
                            {parsed.length === 1 ? "recipient" : "recipients"}
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={parsed.length === 0 || submitting}>
                        {submitting
                            ? "Sending…"
                            : `Send ${parsed.length} invite${parsed.length === 1 ? "" : "s"}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
