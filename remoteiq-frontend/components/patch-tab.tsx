"use client";

import React from "react";
import { ColumnDef, SortingState, ColumnFiltersState, VisibilityState } from "@tanstack/react-table";
import { ArrowUpDown, RefreshCw, ShieldCheck, Download } from "lucide-react";

import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PatchStatus = "Required" | "Installed" | "Pending";

export type PatchRow = {
    id: string;
    title: string;
    severity: string | null;
    requiresReboot: boolean;
    kbIds: string[];
    status: PatchStatus;
};

type LatestResp = {
    ok: boolean;
    lastScanAt: string | null;
    patches: Array<{
        id: string;
        title: string;
        severity: string | null;
        requiresReboot: boolean;
        kbIds: string[];
        status?: string; // backend may send
    }>;
};

type PatchHistoryItem = {
    taskId: string;
    runId: string;
    agentId: string;
    deviceId: string;
    status: string; // running|succeeded|failed|cancelled...
    startedAt: string;
    finishedAt: string | null;
    installed: string[];
    requiresReboot: boolean | null;
    createdBy: string | null;
    createdByName: string | null;
};

type HistoryResp = {
    ok: boolean;
    items: PatchHistoryItem[];
};

function normalizeStatus(raw: unknown): PatchStatus {
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s) return "Pending";
    if (s === "required" || s === "available" || s === "missing" || s === "needs_install") return "Required";
    if (s === "installed" || s === "applied") return "Installed";
    if (s === "pending" || s === "queued" || s === "unknown") return "Pending";
    return "Pending";
}

function fmtDt(input: string | null): string {
    if (!input) return "—";
    const d = new Date(input);
    const t = d.getTime();
    if (!Number.isFinite(t)) return "—";
    try {
        return new Intl.DateTimeFormat("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(d).replace(",", " -");
    } catch {
        return input;
    }
}

function shortId(id: string): string {
    const s = String(id || "");
    if (s.length <= 12) return s;
    return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function whoLabel(h: PatchHistoryItem): string {
    if (h.createdByName && h.createdByName.trim()) return h.createdByName.trim();
    if (h.createdBy && h.createdBy.trim()) return shortId(h.createdBy.trim());
    return "System";
}

async function safeJson(res: Response): Promise<any> {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

async function api<T>(url: string, init?: RequestInit): Promise<{ res: Response; data: T | null }> {
    const res = await fetch(url, {
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
        ...init,
    });
    const data = (await safeJson(res)) as T | null;
    return { res, data };
}

function StatusPill({ status }: { status: PatchStatus }) {
    if (status === "Installed") {
        return (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
                Installed
            </Badge>
        );
    }
    if (status === "Pending") {
        return (
            <Badge className="bg-muted text-foreground/80 border border-border hover:bg-muted" variant="outline">
                Pending
            </Badge>
        );
    }
    return <Badge variant="destructive">Required</Badge>;
}

function HistoryStatusPill({ status }: { status: string }) {
    const s = String(status ?? "").trim().toLowerCase();
    if (s === "succeeded") {
        return (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
                Succeeded
            </Badge>
        );
    }
    if (s === "failed") return <Badge variant="destructive">Failed</Badge>;
    if (s === "cancelled") {
        return (
            <Badge className="bg-muted text-foreground/80 border border-border hover:bg-muted" variant="outline">
                Cancelled
            </Badge>
        );
    }
    if (s === "running") {
        return (
            <Badge className="bg-sky-600 text-white hover:bg-sky-600/90" variant="secondary">
                Running
            </Badge>
        );
    }
    if (s === "queued" || s === "pending") {
        return (
            <Badge className="bg-muted text-foreground/80 border border-border hover:bg-muted" variant="outline">
                Queued
            </Badge>
        );
    }
    return (
        <Badge className="bg-muted text-foreground/80 border border-border hover:bg-muted" variant="outline">
            {status || "Unknown"}
        </Badge>
    );
}

export default function PatchTab({ deviceId }: { deviceId: string }) {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

    const [rows, setRows] = React.useState<PatchRow[]>([]);
    const [lastScanAt, setLastScanAt] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [busyScan, setBusyScan] = React.useState(false);
    const [busyInstallId, setBusyInstallId] = React.useState<string | null>(null);

    const [history, setHistory] = React.useState<PatchHistoryItem[]>([]);
    const [historyLoading, setHistoryLoading] = React.useState(false);

    const [apiMissing, setApiMissing] = React.useState(false);
    const [msg, setMsg] = React.useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

    const loadLatest = React.useCallback(async () => {
        setLoading(true);
        setMsg(null);

        const { res, data } = await api<LatestResp>(`/api/patches/latest?deviceId=${encodeURIComponent(deviceId)}`, {
            method: "GET",
        });

        if (res.status === 404) {
            setApiMissing(true);
            setRows([]);
            setLastScanAt(null);
            setLoading(false);
            return;
        }

        if (!res.ok) {
            setMsg({ kind: "error", text: `Failed to load patches (${res.status}).` });
            setLoading(false);
            return;
        }

        setApiMissing(false);

        const patches = Array.isArray(data?.patches) ? data!.patches : [];
        setLastScanAt(data?.lastScanAt ?? null);

        const mapped: PatchRow[] = patches.map((p) => ({
            id: String(p.id ?? ""),
            title: String(p.title ?? ""),
            severity: p.severity != null ? String(p.severity) : null,
            requiresReboot: !!p.requiresReboot,
            kbIds: Array.isArray(p.kbIds) ? p.kbIds.map((x) => String(x)) : [],
            status: normalizeStatus((p as any).status),
        })).filter((p) => !!p.id);

        setRows(mapped);
        setLoading(false);
    }, [deviceId]);

    const loadHistory = React.useCallback(async () => {
        setHistoryLoading(true);

        const { res, data } = await api<HistoryResp>(
            `/api/patches/history?deviceId=${encodeURIComponent(deviceId)}&limit=200`,
            { method: "GET" }
        );

        if (res.status === 404) {
            setHistory([]);
            setHistoryLoading(false);
            return;
        }

        if (!res.ok) {
            setHistory([]);
            setHistoryLoading(false);
            return;
        }

        const items = Array.isArray(data?.items) ? data!.items : [];
        setHistory(items);
        setHistoryLoading(false);
    }, [deviceId]);

    const refreshAll = React.useCallback(async () => {
        await Promise.all([loadLatest(), loadHistory()]);
    }, [loadLatest, loadHistory]);

    React.useEffect(() => {
        void refreshAll();
    }, [refreshAll]);

    const scan = React.useCallback(async () => {
        setBusyScan(true);
        setMsg(null);

        const { res } = await api<any>(`/api/patches/scan`, {
            method: "POST",
            body: JSON.stringify({ deviceId, includeOptional: false }),
        });

        if (res.status === 404) {
            setApiMissing(true);
            setMsg({ kind: "info", text: "Patch APIs are not enabled in the backend yet (404)." });
            setBusyScan(false);
            return;
        }

        if (!res.ok) {
            setMsg({ kind: "error", text: `Scan request failed (${res.status}).` });
            setBusyScan(false);
            return;
        }

        setApiMissing(false);
        setMsg({ kind: "success", text: "Patch scan queued. Refreshing…" });

        setTimeout(() => void refreshAll(), 1500);
        setBusyScan(false);
    }, [deviceId, refreshAll]);

    const installOne = React.useCallback(async (id: string) => {
        setBusyInstallId(id);
        setMsg(null);

        const { res } = await api<any>(`/api/patches/install`, {
            method: "POST",
            body: JSON.stringify({ deviceId, includeOptional: false, ids: [id] }),
        });

        if (res.status === 404) {
            setApiMissing(true);
            setMsg({ kind: "info", text: "Patch APIs are not enabled in the backend yet (404)." });
            setBusyInstallId(null);
            return;
        }

        if (!res.ok) {
            setMsg({ kind: "error", text: `Install request failed (${res.status}).` });
            setBusyInstallId(null);
            return;
        }

        setApiMissing(false);
        setMsg({ kind: "success", text: "Install queued. Refreshing…" });

        setTimeout(() => void refreshAll(), 1500);
        setBusyInstallId(null);
    }, [deviceId, refreshAll]);

    const columns: ColumnDef<PatchRow>[] = React.useMemo(() => {
        return [
            {
                accessorKey: "title",
                header: ({ column }) => (
                    <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
                        Update <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                ),
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="min-w-0">
                            <div className="truncate font-medium">{r.title}</div>
                            {r.kbIds?.length ? (
                                <div className="truncate text-xs text-muted-foreground">{r.kbIds.join(", ")}</div>
                            ) : null}
                        </div>
                    );
                },
            },
            {
                accessorKey: "severity",
                header: "Severity",
                cell: ({ row }) => {
                    const s = row.original.severity;
                    return <span className="text-sm text-muted-foreground">{s ? String(s) : "—"}</span>;
                },
                meta: { headerClassName: "w-[140px]", cellClassName: "w-[140px]" },
            },
            {
                accessorKey: "requiresReboot",
                header: "Reboot",
                cell: ({ row }) => (
                    <span className="text-sm text-muted-foreground">{row.original.requiresReboot ? "Yes" : "No"}</span>
                ),
                meta: { headerClassName: "w-[110px]", cellClassName: "w-[110px]" },
            },
            {
                accessorKey: "status",
                header: "Status",
                cell: ({ row }) => <StatusPill status={row.original.status} />,
                meta: { headerClassName: "w-[140px]", cellClassName: "w-[140px]" },
            },
            {
                id: "actions",
                header: "",
                cell: ({ row }) => {
                    const r = row.original;
                    const canInstall = r.status === "Required";
                    return (
                        <div className="flex justify-end">
                            <Button
                                size="sm"
                                variant={canInstall ? "default" : "outline"}
                                disabled={!canInstall || busyInstallId === r.id}
                                onClick={() => installOne(r.id)}
                                className="gap-2"
                                title={canInstall ? "Install this update" : "Nothing to install"}
                            >
                                <Download className="h-4 w-4" />
                                {busyInstallId === r.id ? "Installing…" : "Install"}
                            </Button>
                        </div>
                    );
                },
                meta: { headerClassName: "w-[140px]", cellClassName: "w-[140px]" },
            },
        ];
    }, [busyInstallId, installOne]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <CardTitle className="truncate">Patch Management</CardTitle>
                            <div className="text-sm text-muted-foreground">
                                Last scan: <span className="text-foreground">{fmtDt(lastScanAt)}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={refreshAll}
                                className="gap-2"
                                disabled={loading || historyLoading}
                            >
                                <RefreshCw className="h-4 w-4" />
                                Refresh
                            </Button>
                            <Button variant="default" size="sm" onClick={scan} className="gap-2" disabled={busyScan}>
                                <ShieldCheck className="h-4 w-4" />
                                {busyScan ? "Scanning…" : "Scan Now"}
                            </Button>
                        </div>
                    </div>

                    {msg ? (
                        <div
                            className={[
                                "mt-3 rounded-md border px-3 py-2 text-sm",
                                msg.kind === "success"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                    : msg.kind === "error"
                                        ? "border-red-200 bg-red-50 text-red-900"
                                        : "border-border bg-muted/40 text-foreground",
                            ].join(" ")}
                            role="status"
                        >
                            {msg.text}
                        </div>
                    ) : null}

                    {apiMissing ? (
                        <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                            Patch APIs are not available on the backend yet (you’re getting 404s for{" "}
                            <code className="text-xs">/api/patches/*</code>).
                        </div>
                    ) : null}
                </CardHeader>

                <CardContent className="pt-0">
                    <DataTable
                        columns={columns}
                        data={rows}
                        sorting={sorting}
                        setSorting={setSorting}
                        columnFilters={columnFilters}
                        setColumnFilters={setColumnFilters}
                        columnVisibility={columnVisibility}
                        setColumnVisibility={setColumnVisibility}
                        filterColumn="title"
                        filterInputPlaceholder="Filter updates…"
                        compact
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                        <CardTitle className="truncate">Patch History</CardTitle>
                        <Button variant="outline" size="sm" onClick={loadHistory} className="gap-2" disabled={historyLoading}>
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                        </Button>
                    </div>
                    <div className="text-sm text-muted-foreground">
                        Shows all <span className="text-foreground font-medium">patch_install</span> runs (what was installed and when).
                    </div>
                </CardHeader>

                <CardContent className="pt-0">
                    {historyLoading ? (
                        <div className="text-sm text-muted-foreground py-6">Loading history…</div>
                    ) : history.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-6">No patch install history yet.</div>
                    ) : (
                        <div className="rounded-md border overflow-hidden">
                            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                                <div className="col-span-3">When</div>
                                <div className="col-span-2">Status</div>
                                <div className="col-span-2">By</div>
                                <div className="col-span-4">Installed</div>
                                <div className="col-span-1 text-right">Reboot</div>
                            </div>

                            <div className="divide-y">
                                {history.map((h) => {
                                    const when = h.finishedAt ?? h.startedAt;
                                    const installed = Array.isArray(h.installed) ? h.installed : [];
                                    return (
                                        <div key={h.runId} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm">
                                            <div className="col-span-3 text-muted-foreground">{fmtDt(when)}</div>
                                            <div className="col-span-2">
                                                <HistoryStatusPill status={h.status} />
                                            </div>
                                            <div className="col-span-2 text-muted-foreground">
                                                <span title={h.createdByName ?? h.createdBy ?? "System"}>{whoLabel(h)}</span>
                                            </div>
                                            <div className="col-span-4">
                                                {installed.length ? (
                                                    <div className="truncate" title={installed.join(", ")}>
                                                        {installed.join(", ")}
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </div>
                                            <div className="col-span-1 text-right text-muted-foreground">
                                                {h.requiresReboot === null ? "—" : h.requiresReboot ? "Yes" : "No"}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
