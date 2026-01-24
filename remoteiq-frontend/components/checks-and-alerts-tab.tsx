// components/checks-and-alerts-tab.tsx
"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, OctagonX, Info, Search, Filter, Ban, Download, Play } from "lucide-react";

import { fetchDeviceChecks, type DeviceCheck } from "@/lib/api";

import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
} from "@/components/ui/card";
import {
    Table,
    TableHeader,
    TableRow,
    TableHead,
    TableBody,
    TableCell,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/* --------------------------- palette + glyphs --------------------------- */
type CheckStatus = "Passing" | "Failing" | "Warning";
const STATUS_META: Record<
    CheckStatus,
    {
        icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
        text: string;
        chipBg: string;
        ring: string;
        badgeBg: string;
        badgeText: string;
    }
> = {
    Passing: {
        icon: CheckCircle2,
        text: "text-emerald-500",
        chipBg: "bg-emerald-500/15",
        ring: "ring-emerald-500/25",
        badgeBg: "bg-emerald-500",
        badgeText: "text-white",
    },
    Warning: {
        icon: AlertTriangle,
        text: "text-amber-500",
        chipBg: "bg-amber-500/15",
        ring: "ring-amber-500/25",
        badgeBg: "bg-amber-500",
        badgeText: "text-black",
    },
    Failing: {
        icon: OctagonX,
        text: "text-red-500",
        chipBg: "bg-red-500/15",
        ring: "ring-red-500/25",
        badgeBg: "bg-red-500",
        badgeText: "text-white",
    },
};

function StatusGlyph({
    status,
    size = 18,
    className = "",
}: {
    status: CheckStatus;
    size?: number;
    className?: string;
}) {
    const s = STATUS_META[status];
    const Icon = s.icon;
    return (
        <span
            className={[
                "inline-flex items-center justify-center rounded-md p-1 ring-1",
                s.chipBg,
                s.ring,
                className,
            ].join(" ")}
            aria-hidden="true"
        >
            <Icon width={size} height={size} className={s.text} />
        </span>
    );
}

function StatusCountBadge({
    status,
    children,
    title,
    size = "md",
}: {
    status: CheckStatus;
    children: React.ReactNode;
    title?: string;
    size?: "sm" | "md" | "lg";
}) {
    const s = STATUS_META[status];
    const sizeClasses =
        size === "lg"
            ? "h-8 min-w-[2.25rem] px-2.5 text-sm font-semibold"
            : size === "sm"
                ? "h-5 min-w-[1.25rem] px-1.5 text-[11px]"
                : "h-6 min-w-[1.5rem] px-2 text-xs font-medium";
    return (
        <span
            title={title}
            className={[
                "inline-flex items-center justify-center rounded-full",
                sizeClasses,
                s.badgeBg,
                s.badgeText,
                "shadow-sm ring-1 ring-black/5 dark:ring-white/5",
            ].join(" ")}
        >
            {children}
        </span>
    );
}

/* ------------------------------- types (UI) ------------------------------- */
type Severity = "WARN" | "CRIT";
type CheckType =
    | "PING" | "CPU" | "MEMORY" | "DISK" | "SERVICE" | "PROCESS" | "PORT" | "WINEVENT"
    | "SOFTWARE" | "SECURITY" | "SCRIPT" | "PATCH" | "CERT" | "SMART" | "RDP" | "SMB" | "FIREWALL";

type AugmentedDeviceCheck = DeviceCheck & {
    type?: CheckType;
    severity?: Severity;
    category?: string;
    tags?: string[];
    thresholds?: Record<string, any>;
    metrics?: Record<string, number | string | boolean>;
    maintenance?: boolean;
    dedupeKey?: string;
};

/* ------------------------------- utilities ------------------------------- */

function formatWhen(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(+d)) return iso;
    return d.toLocaleString();
}

function truncate(str: string, max = 160) {
    if (!str) return "";
    return str.length > max ? `${str.slice(0, max)}…` : str;
}

function toCSV(items: AugmentedDeviceCheck[]) {
    const cols = [
        "id",
        "name",
        "status",
        "type",
        "severity",
        "category",
        "lastRun",
        "maintenance",
        "dedupeKey",
        "output",
    ];
    const esc = (v: any) => {
        if (v == null) return "";
        const s = String(v);
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    };
    const header = cols.join(",");
    const lines = items.map((it) =>
        [
            it.id,
            it.name,
            it.status,
            (it as any).type ?? "",
            (it as any).severity ?? "",
            (it as any).category ?? "",
            it.lastRun ?? "",
            (it as any).maintenance ?? "",
            (it as any).dedupeKey ?? "",
            it.output ?? "",
        ].map(esc).join(",")
    );
    return [header, ...lines].join("\n");
}

/* ------------------------------ WS utilities ------------------------------ */

type UiWsIncoming =
    | { t: "welcome" }
    | { t: "device_checks_updated"; deviceId: string; changed?: number; at?: string }
    | { t: "error"; message: string }
    | { t: "pong" };

function makeWsUrl(path = "/ws") {
    const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
    const host = typeof window !== "undefined" ? window.location.host : "";
    return `${proto}://${host}${path}`;
}

/* -------------------------------- component ------------------------------- */

export default function ChecksAndAlertsTab({ deviceId: deviceIdProp }: { deviceId?: string }) {
    const params = useParams<{ deviceId: string }>();
    const deviceId = deviceIdProp ?? params?.deviceId;

    const [items, setItems] = React.useState<AugmentedDeviceCheck[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    // client-side UI aids
    const [q, setQ] = React.useState("");
    const [statusFilter, setStatusFilter] = React.useState<"all" | CheckStatus>("all");
    const [severityFilter, setSeverityFilter] = React.useState<"all" | Severity>("all");
    const [typeFilter, setTypeFilter] = React.useState<"all" | CheckType>("all");
    const [selected, setSelected] = React.useState<AugmentedDeviceCheck | null>(null);
    const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

    // WS refs
    const wsRef = React.useRef<WebSocket | null>(null);
    const retryRef = React.useRef<number>(1000); // backoff ms
    const pingTimerRef = React.useRef<number | null>(null);
    const reconnectTimerRef = React.useRef<number | null>(null);
    const debounceFetchTimerRef = React.useRef<number | null>(null);
    const subscribedDeviceRef = React.useRef<string | null>(null);
    const connectWsRef = React.useRef<null | (() => void)>(null);

    const isVisible = () =>
        typeof document !== "undefined" ? document.visibilityState !== "hidden" : true;

    const clearTimer = (ref: React.MutableRefObject<number | null>) => {
        if (ref.current) {
            window.clearTimeout(ref.current);
            ref.current = null;
        }
    };

    const stopHeartbeat = React.useCallback(() => {
        clearTimer(pingTimerRef);
    }, []);

    const startHeartbeat = React.useCallback(() => {
        stopHeartbeat();
        pingTimerRef.current = window.setTimeout(function tick() {
            try {
                wsRef.current?.send(JSON.stringify({ t: "ping", at: new Date().toISOString() }));
            } catch { /* ignore */ }
            pingTimerRef.current = window.setTimeout(tick, 25_000) as unknown as number;
        }, 25_000) as unknown as number;
    }, [stopHeartbeat]);

    const scheduleReconnect = React.useCallback(() => {
        clearTimer(reconnectTimerRef);
        const delay = Math.min(retryRef.current, 25_000);
        reconnectTimerRef.current = window.setTimeout(() => {
            connectWsRef.current?.();
            retryRef.current = Math.min(retryRef.current * 2, 25_000);
        }, delay) as unknown as number;
    }, []);

    const safeCloseWs = React.useCallback(() => {
        try { wsRef.current?.close(); } catch { /* ignore */ }
        wsRef.current = null;
        stopHeartbeat();
    }, [stopHeartbeat]);

    const subscribeDevice = (id: string | null | undefined) => {
        const target = id ? String(id) : null;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (!target) return;
        if (subscribedDeviceRef.current === target) return;
        subscribedDeviceRef.current = target;
        try {
            wsRef.current.send(JSON.stringify({ t: "subscribe_device", deviceId: target }));
        } catch { /* ignore */ }
    };

    const refetchChecks = React.useCallback(async () => {
        if (!deviceId) return;
        try {
            setLoading(true);
            setError(null);
            const res = await fetchDeviceChecks(deviceId);
            setItems(((res as any)?.items ?? []) as AugmentedDeviceCheck[]);
        } catch (e: any) {
            setError(e?.message ?? "Failed to load checks");
        } finally {
            setLoading(false);
        }
    }, [deviceId]);

    const handleIncoming = React.useCallback((raw: MessageEvent<string>) => {
        let msg: UiWsIncoming | null = null;
        try {
            msg = JSON.parse(raw.data) as UiWsIncoming;
        } catch {
            return;
        }
        if (!msg || typeof (msg as any).t !== "string") return;

        switch (msg.t) {
            case "welcome": {
                subscribeDevice(deviceId);
                break;
            }
            case "device_checks_updated": {
                if (!deviceId || msg.deviceId !== String(deviceId)) return;
                if (debounceFetchTimerRef.current) window.clearTimeout(debounceFetchTimerRef.current);
                debounceFetchTimerRef.current = window.setTimeout(async () => {
                    await refetchChecks();
                }, 500) as unknown as number;
                break;
            }
            case "pong":
            default:
                break;
        }
    }, [deviceId, refetchChecks]);

    const connectWs = React.useCallback(() => {
        if (!isVisible()) return;
        try {
            safeCloseWs();
            const url = makeWsUrl("/ws");
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.addEventListener("open", () => {
                retryRef.current = 1000;
                startHeartbeat();
                try {
                    ws.send(JSON.stringify({ t: "ui_hello" }));
                } catch { /* ignore */ }
                subscribeDevice(deviceId);
            });

            ws.addEventListener("message", handleIncoming);
            ws.addEventListener("close", () => {
                stopHeartbeat();
                scheduleReconnect();
            });
            ws.addEventListener("error", () => {
                try { ws.close(); } catch { /* ignore */ }
            });
        } catch {
            scheduleReconnect();
        }
    }, [deviceId, handleIncoming, safeCloseWs, scheduleReconnect, startHeartbeat, stopHeartbeat]);

    React.useEffect(() => {
        connectWsRef.current = connectWs;
    }, [connectWs]);

    React.useEffect(() => {
        let alive = true;
        (async () => {
            if (!deviceId) return;
            setLoading(true);
            setError(null);
            try {
                const res = await fetchDeviceChecks(deviceId);
                if (!alive) return;
                setItems(((res as any)?.items ?? []) as AugmentedDeviceCheck[]);
            } catch (e: any) {
                if (!alive) return;
                setError(e?.message ?? "Failed to load checks");
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [deviceId]);

    React.useEffect(() => {
        connectWs();

        if (deviceId) subscribeDevice(deviceId);

        const onVis = () => {
            if (isVisible()) connectWsRef.current?.();
        };
        document.addEventListener("visibilitychange", onVis);

        return () => {
            document.removeEventListener("visibilitychange", onVis);
            clearTimer(reconnectTimerRef);
            clearTimer(pingTimerRef);
            clearTimer(debounceFetchTimerRef);
            safeCloseWs();
        };
    }, [deviceId, connectWs, safeCloseWs]);

    const failingChecks = items.filter((c) => c.status === "Failing").length;
    const warningChecks = items.filter((c) => c.status === "Warning").length;

    const allTypes = React.useMemo(() => {
        const t = new Set<string>();
        for (const it of items) if ((it as any).type) t.add((it as any).type as string);
        return Array.from(t).sort();
    }, [items]);

    const filtered = items
        .filter((c) => (statusFilter === "all" ? true : c.status === statusFilter))
        .filter((c) => (severityFilter === "all" ? true : (c as any).severity === severityFilter))
        .filter((c) => (typeFilter === "all" ? true : (c as any).type === typeFilter))
        .filter((c) => {
            if (!q.trim()) return true;
            const hay = [
                c.name,
                c.output ?? "",
                (c as any).type ?? "",
                (c as any).category ?? "",
                Object.entries((c as any).metrics ?? {}).map(([k, v]) => `${k}:${v}`).join(" "),
                Object.entries((c as any).thresholds ?? {}).map(([k, v]) => `${k}:${v}`).join(" "),
                ((c as any).tags ?? []).join(" "),
            ].join(" ").toLowerCase();
            return hay.includes(q.toLowerCase());
        })
        .sort((a, b) => {
            const da = (a.lastRun ? +new Date(a.lastRun) : 0);
            const db = (b.lastRun ? +new Date(b.lastRun) : 0);
            return db - da;
        });

    const toggleSelectAll = (checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) filtered.forEach((r) => next.add(r.id));
        else filtered.forEach((r) => next.delete(r.id));
        setSelectedIds(next);
    };
    const toggleRow = (id: string, on: boolean) => {
        const next = new Set(selectedIds);
        if (on) next.add(id);
        else next.delete(id);
        setSelectedIds(next);
    };

    const exportCSV = () => {
        const csv = toCSV(filtered);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `device-checks-${deviceId ?? "unknown"}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const bulkAck = () => { /* pending */ };
    const bulkSilence = () => { /* pending */ };
    const bulkResolve = () => { /* pending */ };
    const runNow = (id: string) => { /* pending */ };

    return (
        <TooltipProvider>
            <div className="grid gap-6">
                <div className="grid md:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Active Alerts</CardTitle>
                            <CardDescription>A summary of checks that require attention.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4">
                            <div className="flex items-center justify-between p-4 rounded-lg ring-1 ring-red-500/25 bg-red-500/10">
                                <div className="flex items-center gap-4">
                                    <StatusGlyph status="Failing" className="scale-110" />
                                    <div>
                                        <p className="font-semibold">
                                            {failingChecks} Failing Check{failingChecks !== 1 && "s"}
                                        </p>
                                        <p className="text-sm text-muted-foreground">Immediate attention required.</p>
                                    </div>
                                </div>
                                <StatusCountBadge status="Failing" size="lg" title="Failing count">
                                    {failingChecks}
                                </StatusCountBadge>
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-lg ring-1 ring-amber-500/25 bg-amber-500/10">
                                <div className="flex items-center gap-4">
                                    <StatusGlyph status="Warning" className="scale-110" />
                                    <div>
                                        <p className="font-semibold">
                                            {warningChecks} Warning Check{warningChecks !== 1 && "s"}
                                        </p>
                                        <p className="text-sm text-muted-foreground">Potential issues detected.</p>
                                    </div>
                                </div>
                                <StatusCountBadge status="Warning" size="lg" title="Warning count">
                                    {warningChecks}
                                </StatusCountBadge>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Checks Summary</CardTitle>
                            <CardDescription>Overview of all monitored checks on this device.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3">
                            {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
                            {error && <div className="text-sm text-red-600">{error}</div>}
                            {!loading && !error && items.length === 0 && (
                                <div className="text-sm text-muted-foreground">No checks found.</div>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    variant={statusFilter === "all" ? "default" : "secondary"}
                                    size="sm"
                                    onClick={() => setStatusFilter("all")}
                                >
                                    All
                                </Button>
                                <Button
                                    variant={statusFilter === "Failing" ? "destructive" : "secondary"}
                                    size="sm"
                                    onClick={() => setStatusFilter("Failing")}
                                >
                                    <StatusGlyph status="Failing" className="mr-2" /> Failing
                                </Button>
                                <Button
                                    variant={statusFilter === "Warning" ? "default" : "secondary"}
                                    size="sm"
                                    onClick={() => setStatusFilter("Warning")}
                                >
                                    <StatusGlyph status="Warning" className="mr-2" /> Warning
                                </Button>
                                <Button
                                    variant={statusFilter === "Passing" ? "default" : "secondary"}
                                    size="sm"
                                    onClick={() => setStatusFilter("Passing")}
                                >
                                    <StatusGlyph status="Passing" className="mr-2" /> Passing
                                </Button>

                                <Separator orientation="vertical" className="mx-1 h-6" />

                                <div className="relative w-full sm:w-64">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        className="pl-8"
                                        placeholder="Search checks, type, tags, output…"
                                        value={q}
                                        onChange={(e) => setQ(e.target.value)}
                                    />
                                </div>

                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" size="sm" className="ml-auto">
                                            <Filter className="mr-2 h-4 w-4" />
                                            More Filters
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-80">
                                        <div className="grid gap-3">
                                            <div className="text-sm font-medium">Severity</div>
                                            <div className="flex gap-2">
                                                <Button
                                                    size="sm"
                                                    variant={severityFilter === "all" ? "default" : "secondary"}
                                                    onClick={() => setSeverityFilter("all")}
                                                >
                                                    All
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant={severityFilter === "WARN" ? "default" : "secondary"}
                                                    onClick={() => setSeverityFilter("WARN")}
                                                >
                                                    WARN
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant={severityFilter === "CRIT" ? "destructive" : "secondary"}
                                                    onClick={() => setSeverityFilter("CRIT")}
                                                >
                                                    CRIT
                                                </Button>
                                            </div>

                                            <Separator />

                                            <div className="text-sm font-medium">Type</div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button
                                                    size="sm"
                                                    variant={typeFilter === "all" ? "default" : "secondary"}
                                                    onClick={() => setTypeFilter("all")}
                                                >
                                                    All
                                                </Button>
                                                {allTypes.map((t) => (
                                                    <Button
                                                        key={t}
                                                        size="sm"
                                                        variant={typeFilter === (t as CheckType) ? "default" : "secondary"}
                                                        onClick={() => setTypeFilter(t as CheckType)}
                                                    >
                                                        {t}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                <div className="flex items-center gap-2 ml-auto">
                                    <Button variant="outline" size="sm" onClick={exportCSV}>
                                        <Download className="mr-2 h-4 w-4" /> Export CSV
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Info className="h-4 w-4" />
                                <span>Type/Severity/Thresholds/Metrics columns show when provided by backend.</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Check History</CardTitle>
                        <CardDescription>A log of the most recent check results.</CardDescription>
                    </CardHeader>

                    <CardContent className="overflow-x-auto">
                        <div className="flex items-center justify-between pb-2">
                            <div className="flex items-center gap-3">
                                <Checkbox
                                    checked={filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))}
                                    onCheckedChange={(v) => toggleSelectAll(Boolean(v))}
                                    aria-label="Select all"
                                />
                                <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span>
                                            <Button variant="secondary" size="sm" disabled onClick={bulkAck}>
                                                Ack
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Bulk acknowledge (backend route pending)</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span>
                                            <Button variant="outline" size="sm" disabled onClick={bulkSilence}>
                                                Silence
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Bulk silence (backend route pending)</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span>
                                            <Button variant="ghost" size="sm" disabled onClick={bulkResolve}>
                                                Resolve
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Bulk resolve (backend route pending)</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>

                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[44px]">
                                        <Checkbox
                                            checked={filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))}
                                            onCheckedChange={(v) => toggleSelectAll(Boolean(v))}
                                            aria-label="Select all"
                                        />
                                    </TableHead>
                                    <TableHead className="w-[44px]"></TableHead>
                                    <TableHead>Check Name</TableHead>
                                    <TableHead className="hidden xl:table-cell">Type</TableHead>
                                    <TableHead className="hidden lg:table-cell">Severity</TableHead>
                                    <TableHead className="hidden 2xl:table-cell">Metrics</TableHead>
                                    <TableHead className="hidden 2xl:table-cell">Thresholds</TableHead>
                                    <TableHead>Last Run</TableHead>
                                    <TableHead>Output</TableHead>
                                    <TableHead className="hidden md:table-cell">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map((check) => {
                                    const type = (check as any).type as string | undefined;
                                    const severity = (check as any).severity as Severity | undefined;
                                    const metrics = (check as any).metrics as Record<string, any> | undefined;
                                    const thresholds = (check as any).thresholds as Record<string, any> | undefined;
                                    const tags = (check as any).tags as string[] | undefined;
                                    const output = check.output || "";
                                    const long = output.length > 160;

                                    return (
                                        <TableRow key={check.id} className="hover:bg-accent/40">
                                            <TableCell>
                                                <Checkbox
                                                    checked={selectedIds.has(check.id)}
                                                    onCheckedChange={(v) => toggleRow(check.id, Boolean(v))}
                                                    aria-label={`Select ${check.name}`}
                                                />
                                            </TableCell>

                                            <TableCell>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span>
                                                            <StatusGlyph status={check.status as CheckStatus} />
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>{check.status}</TooltipContent>
                                                </Tooltip>
                                            </TableCell>

                                            <TableCell className="font-medium">
                                                <button
                                                    type="button"
                                                    className="text-left hover:underline decoration-dotted"
                                                    onClick={() => setSelected(check)}
                                                    title="View details"
                                                >
                                                    {check.name}
                                                </button>
                                                {!!tags?.length && (
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {tags.slice(0, 4).map((t) => (
                                                            <Badge key={t} variant="secondary" className="text-[10px]">
                                                                {t}
                                                            </Badge>
                                                        ))}
                                                        {tags.length > 4 && (
                                                            <Badge variant="outline" className="text-[10px]">
                                                                +{tags.length - 4}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                )}
                                            </TableCell>

                                            <TableCell className="hidden xl:table-cell">
                                                {type ? <Badge variant="secondary">{type}</Badge> : <span className="text-muted-foreground">—</span>}
                                            </TableCell>

                                            <TableCell className="hidden lg:table-cell">
                                                {severity ? (
                                                    <Badge variant={severity === "CRIT" ? "destructive" : "secondary"}>
                                                        {severity}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>

                                            <TableCell className="hidden 2xl:table-cell">
                                                {metrics && Object.keys(metrics).length ? (
                                                    <div className="flex flex-wrap gap-1">
                                                        {Object.entries(metrics).slice(0, 5).map(([k, v]) => (
                                                            <Badge key={k} variant="outline" className="text-[10px]">
                                                                {k}:{String(v)}
                                                            </Badge>
                                                        ))}
                                                        {Object.keys(metrics).length > 5 && (
                                                            <Badge variant="outline" className="text-[10px]">
                                                                +{Object.keys(metrics).length - 5}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>

                                            <TableCell className="hidden 2xl:table-cell">
                                                {thresholds && Object.keys(thresholds).length ? (
                                                    <div className="flex flex-wrap gap-1">
                                                        {Object.entries(thresholds).slice(0, 5).map(([k, v]) => (
                                                            <Badge key={k} variant="outline" className="text-[10px]">
                                                                {k}:{String(v)}
                                                            </Badge>
                                                        ))}
                                                        {Object.keys(thresholds).length > 5 && (
                                                            <Badge variant="outline" className="text-[10px]">
                                                                +{Object.keys(thresholds).length - 5}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </TableCell>

                                            <TableCell className="text-muted-foreground">{formatWhen(check.lastRun)}</TableCell>

                                            <TableCell className="text-muted-foreground">
                                                {long ? (
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button variant="ghost" size="sm" className="px-0 h-auto text-left font-normal">
                                                                {truncate(output)}
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="max-w-[80vw] md:max-w-[50vw] whitespace-pre-wrap">
                                                            {output}
                                                        </PopoverContent>
                                                    </Popover>
                                                ) : (
                                                    <span className="whitespace-pre-wrap">
                                                        {output || <span className="text-muted-foreground">—</span>}
                                                    </span>
                                                )}
                                            </TableCell>

                                            <TableCell className="hidden md:table-cell">
                                                <div className="flex items-center gap-2">
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span>
                                                                <Button size="sm" variant="outline" disabled onClick={() => runNow(check.id)}>
                                                                    <Play className="h-3.5 w-3.5 mr-1" /> Run now
                                                                </Button>
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Dispatch on-demand run (backend pending)</TooltipContent>
                                                    </Tooltip>

                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span>
                                                                <Button size="sm" variant="ghost" disabled>
                                                                    <Ban className="h-3.5 w-3.5 mr-1" /> Silence
                                                                </Button>
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Silence alert (backend pending)</TooltipContent>
                                                    </Tooltip>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}

                                {!loading && filtered.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={10} className="text-sm text-muted-foreground">
                                            {items.length ? "No checks match the current filters." : "No checks found."}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
                    <SheetContent side="right" className="w-full sm:max-w-xl">
                        <SheetHeader>
                            <SheetTitle className="flex items-center gap-2">
                                {selected && <StatusGlyph status={selected.status as CheckStatus} />}
                                <span>{selected?.name ?? "Check"}</span>
                            </SheetTitle>
                            <SheetDescription>
                                {selected ? (
                                    <div className="grid gap-3 text-sm">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {(selected as any).type && <Badge variant="secondary">{(selected as any).type}</Badge>}
                                            {(selected as any).severity && (
                                                <Badge variant={(selected as any).severity === "CRIT" ? "destructive" : "secondary"}>
                                                    {(selected as any).severity}
                                                </Badge>
                                            )}
                                            {(selected as any).category && <Badge variant="outline">{(selected as any).category}</Badge>}
                                            {(selected as any).maintenance && <Badge variant="outline">Maintenance</Badge>}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground">Last run:</span>
                                            <span>{formatWhen(selected.lastRun) || "—"}</span>
                                        </div>

                                        {(selected as any).dedupeKey && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">Key:</span>
                                                <code className="text-xs">{(selected as any).dedupeKey}</code>
                                            </div>
                                        )}

                                        {(selected as any).tags?.length ? (
                                            <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">Tags:</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {(selected as any).tags.map((t: string) => (
                                                        <Badge key={t} variant="secondary" className="text-[10px]">
                                                            {t}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}

                                        <Separator />

                                        <Tabs defaultValue="output">
                                            <TabsList className="grid grid-cols-3 w-full">
                                                <TabsTrigger value="output">Output</TabsTrigger>
                                                <TabsTrigger value="metrics">Metrics</TabsTrigger>
                                                <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
                                            </TabsList>

                                            <TabsContent value="output" className="pt-2">
                                                <div className="rounded-md border p-3 bg-muted/30 whitespace-pre-wrap">
                                                    {selected.output || <span className="text-muted-foreground">No output</span>}
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="metrics" className="pt-2">
                                                {Object.keys((selected as any).metrics ?? {}).length ? (
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {Object.entries((selected as any).metrics).map(([k, v]) => (
                                                            <div
                                                                key={k}
                                                                className="flex items-center justify-between rounded border bg-muted/20 px-2 py-1"
                                                            >
                                                                <span className="text-muted-foreground">{k}</span>
                                                                <span className="font-medium">{String(v)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-muted-foreground">No metrics</div>
                                                )}
                                            </TabsContent>

                                            <TabsContent value="thresholds" className="pt-2">
                                                {Object.keys((selected as any).thresholds ?? {}).length ? (
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {Object.entries((selected as any).thresholds).map(([k, v]) => (
                                                            <div
                                                                key={k}
                                                                className="flex items-center justify-between rounded border bg-muted/20 px-2 py-1"
                                                            >
                                                                <span className="text-muted-foreground">{k}</span>
                                                                <span className="font-medium">{String(v)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-muted-foreground">No thresholds</div>
                                                )}
                                            </TabsContent>
                                        </Tabs>
                                    </div>
                                ) : null}
                            </SheetDescription>
                        </SheetHeader>
                    </SheetContent>
                </Sheet>
            </div>
        </TooltipProvider>
    );
}
