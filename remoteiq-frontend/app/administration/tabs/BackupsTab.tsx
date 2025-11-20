"use client";

import * as React from "react";
import {
    Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
    Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
    ArchiveRestore, Download, RefreshCcw, FileText, Shield, RotateCcw,
    XCircle, Repeat2, Filter, Trash2, Info, ListChecks, MoreVertical, Plus, Trash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LabeledInput, LabeledNumber, CheckToggle } from "../helpers";
import {
    getBackupConfig, updateBackupConfig, getBackupPermissions,
    listStorageConnectionsLite, listBackupHistory,
    runBackupNow as apiRunBackupNow, pruneBackups as apiPruneBackups,
    testBackupDestination, retryBackup, cancelBackup, startRestore,
    getCronNextRuns,
    type BackupConfig as ApiBackupConfig,
    type BackupHistoryRow, type BackupTarget, type Destination as ApiDestination,
    type LocalDest, type S3Dest, type NextcloudDest, type GDriveDest,
    type RemoteSFTPDest, type ConnectionLite, type StorageKind,
    type Permissions, type ScheduleKind,
} from "@/lib/backups";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast, type ToastOptions } from "@/components/ui/use-toast";
import {
    DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

type Dest = ApiDestination;
type HistoryStatus = "any" | "success" | "failed" | "running";

type FanoutDest =
    | { kind: "local"; path: string; isPrimary?: boolean; priority?: number }
    | { kind: "s3"; connectionId: string; bucket?: string; prefix?: string; isPrimary?: boolean; priority?: number }
    | { kind: "nextcloud"; connectionId: string; path: string; isPrimary?: boolean; priority?: number }
    | { kind: "gdrive"; connectionId: string; subfolder?: string; isPrimary?: boolean; priority?: number }
    | { kind: "remote"; connectionId: string; path: string; isPrimary?: boolean; priority?: number };

type ConfigState = {
    enabled: boolean;
    targets: BackupTarget[];
    schedule: ScheduleKind;
    cronExpr: string;
    retentionDays: number | "";
    encrypt: boolean;
    destination: Dest;
    /** NEW */
    extraDestinations: FanoutDest[];
    notifications?: { email?: boolean; webhook?: boolean; slack?: boolean };
    /** hints */
    minSuccess?: number | "";
    parallelism?: number | "";
};

const TZ = "America/New_York";

/* ---------------- helpers ---------------- */

function isValidCron(expr: string) {
    return /^(\S+\s+){4}\S+$/.test((expr || "").trim());
}

function humanNextRun(schedule: ScheduleKind) {
    try {
        const now = new Date();
        const localNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }));

        if (schedule === "hourly") {
            const list: string[] = [];
            let cursor = new Date(localNow);
            cursor.setMinutes(0, 0, 0);
            if (localNow.getMinutes() > 0 || localNow.getSeconds() > 0)
                cursor.setHours(cursor.getHours() + 1);
            for (let i = 0; i < 5; i++) {
                list.push(cursor.toLocaleString("en-US", {
                    timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit",
                }));
                cursor.setHours(cursor.getHours() + 1);
            }
            return list;
        }

        if (schedule === "daily") {
            const list: string[] = [];
            let cursor = new Date(localNow);
            cursor.setHours(3, 0, 0, 0);
            if (localNow >= cursor) cursor.setDate(cursor.getDate() + 1);
            for (let i = 0; i < 5; i++) {
                list.push(cursor.toLocaleString("en-US", {
                    timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit",
                }));
                cursor.setDate(cursor.getDate() + 1);
            }
            return list;
        }

        if (schedule === "weekly") {
            const list: string[] = [];
            const localNow = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
            const cursor = new Date(localNow);
            cursor.setHours(3, 0, 0, 0);

            // Next Sunday 03:00 local
            const day = cursor.getDay(); // 0 = Sun
            const daysUntilSunday = (7 - day) % 7;
            cursor.setDate(cursor.getDate() + daysUntilSunday);

            if (localNow >= cursor) cursor.setDate(cursor.getDate() + 7);

            for (let i = 0; i < 5; i++) {
                list.push(cursor.toLocaleString("en-US", {
                    timeZone: TZ, weekday: "long", hour: "2-digit", minute: "2-digit",
                }));
                cursor.setDate(cursor.getDate() + 7);
            }
            return list;
        }


        if (schedule === "cron") return null;
    } catch { }
    return [];
}

function validateDest(d: FanoutDest): string[] {
    const errs: string[] = [];
    switch (d.kind) {
        case "local":
            if (!d.path) errs.push("Local path required");
            else {
                const abs = d.path.startsWith("/") || /^[A-Za-z]:\\/.test(d.path);
                if (!abs) errs.push("Local path must be absolute");
            }
            break;
        case "nextcloud":
            if (!("connectionId" in d) || !d.connectionId) errs.push("Nextcloud connection required");
            if (!d.path || !d.path.startsWith("/")) errs.push("Nextcloud path should start with '/'");
            break;
        case "remote":
            if (!("connectionId" in d) || !d.connectionId) errs.push("SFTP connection required");
            if (!d.path) errs.push("Remote directory path required");
            else {
                const abs = d.path.startsWith("/") || /^[A-Za-z]:\\/.test(d.path);
                if (!abs) errs.push("Remote directory path must be absolute");
            }
            break;
        case "s3":
            if (!("connectionId" in d) || !d.connectionId) errs.push("S3 connection required");
            break;
        case "gdrive":
            if (!("connectionId" in d) || !d.connectionId) errs.push("Google Drive connection required");
            break;
    }
    return errs;
}

function validateConfig(c: ConfigState): string[] {
    const errs: string[] = [];
    const days = Number(c.retentionDays);
    if (!Number.isFinite(days) || days < 1 || days > 3650)
        errs.push("Retention days must be between 1 and 3650.");
    if (c.schedule === "cron" && !isValidCron(c.cronExpr))
        errs.push("Cron expression looks invalid.");
    if (!c.targets.length) errs.push("Select at least one backup target.");

    // primary
    errs.push(...validateDest(c.destination as FanoutDest));

    // extras
    for (const e of c.extraDestinations) errs.push(...validateDest(e));

    if (c.minSuccess != null && Number(c.minSuccess) < 1) errs.push("Min success must be >= 1");
    if (c.parallelism != null && Number(c.parallelism) < 1) errs.push("Parallelism must be >= 1");
    return errs;
}

/* ---------------- component ---------------- */

export default function BackupsTab({ push }: { push?: (opts: ToastOptions) => void; }) {
    const { toast } = useToast();
    const notify = React.useMemo(() => push ?? toast, [push, toast]);

    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [running, setRunning] = React.useState(false);
    const [testingDest, setTestingDest] = React.useState(false);
    const [restoreId, setRestoreId] = React.useState<string | null>(null);
    const [restoreConfirm, setRestoreConfirm] = React.useState("");

    const [errors, setErrors] = React.useState<string[]>([]);

    const [backups, setBackups] = React.useState<ConfigState>({
        enabled: false,
        targets: [],
        schedule: "daily",
        cronExpr: "0 3 * * *",
        retentionDays: 30,
        encrypt: true,
        destination: { kind: "local", path: "/var/remoteiq/backups" } as LocalDest,
        extraDestinations: [],
        notifications: { email: false, webhook: false, slack: false },
        minSuccess: 1,
        parallelism: 2,
    });

    const [perms, setPerms] = React.useState<Permissions>({ restore: false, download: false });
    const [connAll, setConnAll] = React.useState<ConnectionLite[]>([]);
    const [selectedConnId, setSelectedConnId] = React.useState<string>("");

    // history
    const [historyLoading, setHistoryLoading] = React.useState(true);
    const [historyRaw, setHistoryRaw] = React.useState<BackupHistoryRow[]>([]);
    const [historyView, setHistoryView] = React.useState<BackupHistoryRow[]>([]);
    const [cursor, setCursor] = React.useState<string | null>(null);
    const [cursorStack, setCursorStack] = React.useState<string[]>([]);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);

    const [statusFilter, setStatusFilter] = React.useState<HistoryStatus>("any");
    const [search, setSearch] = React.useState("");
    const [dateFrom, setDateFrom] = React.useState<string>("");
    const [dateTo, setDateTo] = React.useState<string>("");

    const nextRunList = humanNextRun(backups.schedule);
    const [cronNextRuns, setCronNextRuns] = React.useState<string[] | null>(null);

    /* ------ load config + perms + connections ------ */
    const connsFor = (k: Dest["kind"]) => {
        const map: Record<Dest["kind"], StorageKind | null> = {
            local: null, s3: "s3", nextcloud: "nextcloud", gdrive: "gdrive", remote: "sftp",
        };
        const want = map[k];
        if (!want) return [];
        return connAll.filter((c) => c.kind === want);
    };

    const loadConfig = React.useCallback(async () => {
        try {
            const cfg = await getBackupConfig();
            const inDest: any = (cfg as any).destination || {};
            const extras: any[] = Array.isArray((cfg as any).extraDestinations) ? (cfg as any).extraDestinations : [];

            function mapIn(d: any): FanoutDest {
                switch (d?.kind) {
                    case "s3": return { kind: "s3", connectionId: d.connectionId ?? "", bucket: d.bucket ?? "", prefix: d.prefix ?? "" };
                    case "nextcloud": return { kind: "nextcloud", connectionId: d.connectionId ?? "", path: d.path ?? "/Backups/RemoteIQ" };
                    case "gdrive": return { kind: "gdrive", connectionId: d.connectionId ?? "", subfolder: d.subfolder ?? "" };
                    case "remote": return { kind: "remote", connectionId: d.connectionId ?? "", path: d.path ?? "/srv/remoteiq/backups" };
                    case "local":
                    default: return { kind: "local", path: d?.path ?? "/var/remoteiq/backups" };
                }
            }

            const dest = mapIn(inDest) as Dest;
            const extrasMapped = extras.map(mapIn);

            // set selectedConnId only for connection-backed kinds
            const connId =
                ("connectionId" in dest && (dest as any).connectionId) ? (dest as any).connectionId : "";

            setBackups({
                enabled: !!cfg.enabled,
                targets: (cfg.targets as BackupTarget[]) ?? [],
                schedule: (cfg.schedule as ScheduleKind) ?? "daily",
                cronExpr: cfg.cronExpr || "0 3 * * *",
                retentionDays: typeof cfg.retentionDays === "number" ? cfg.retentionDays : 30,
                encrypt: !!cfg.encrypt,
                destination: dest,
                extraDestinations: extrasMapped,
                notifications: (cfg as any).notifications ?? { email: false, webhook: false, slack: false },
                minSuccess: (cfg as any).minSuccess ?? 1,
                parallelism: (cfg as any).parallelism ?? 2,
            });
            setSelectedConnId(connId);
            setErrors([]);
        } catch (e: any) {
            notify({ title: e?.message || "Failed to load backup config", kind: "destructive", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [notify]);

    const loadPerms = React.useCallback(async () => {
        try {
            const p = await getBackupPermissions();
            if (p) setPerms({ restore: !!p.restore, download: !!p.download });
        } catch (e: any) {
            notify({ title: e?.message || "Failed to load backup permissions", kind: "destructive", variant: "destructive" });
        }
    }, [notify]);

    const loadConnections = React.useCallback(async () => {
        try {
            const res = await listStorageConnectionsLite();
            setConnAll(res?.items ?? []);
        } catch (e: any) {
            notify({ title: e?.message || "Failed to load storage connections", kind: "destructive", variant: "destructive" });
        }
    }, [notify]);

    React.useEffect(() => {
        loadConfig();
        loadPerms();
        loadConnections();
    }, [loadConfig, loadPerms, loadConnections]);

    /* ---------- history ---------- */
    const loadHistory = React.useCallback(
        async (cur?: string | null) => {
            setHistoryLoading(true);
            try {
                const res = await listBackupHistory({
                    cursor: cur ?? undefined,
                    status: statusFilter === "any" ? undefined : statusFilter,
                    q: search.trim() || undefined,
                    from: dateFrom || undefined,
                    to: dateTo || undefined,
                });
                setHistoryRaw(res?.items ?? []);
                setNextCursor(res?.nextCursor ?? null);
            } catch (e: any) {
                setHistoryRaw([]);
                setNextCursor(null);
                notify({ title: e?.message || "Failed to load backup history", kind: "destructive", variant: "destructive" });
            } finally {
                setHistoryLoading(false);
            }
        },
        [statusFilter, search, dateFrom, dateTo, notify]
    );

    React.useEffect(() => {
        loadHistory(cursor);
    }, [cursor, loadHistory]);

    React.useEffect(() => {
        const from = dateFrom ? Date.parse(dateFrom) : null;
        const to = dateTo ? Date.parse(dateTo) : null;
        const q = search.trim().toLowerCase();

        const out = historyRaw.filter((row) => {
            if (statusFilter !== "any" && row.status !== statusFilter) return false;

            if (from || to) {
                const t = Date.parse(row.at.replace(" ", "T") + ":00");
                if (Number.isFinite(from) && t < (from as number)) return false;
                if (Number.isFinite(to)) {
                    const end = new Date(to as number);
                    end.setDate(end.getDate() + 1);
                    if (t >= +end) return false;
                }
            }

            if (q) {
                const hay = `${row.id} ${row.note ?? ""}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        setHistoryView(out);
    }, [historyRaw, statusFilter, search, dateFrom, dateTo]);

    /* ---------- cron next runs ---------- */
    React.useEffect(() => {
        if (backups.schedule !== "cron" || !isValidCron(backups.cronExpr)) {
            setCronNextRuns(null);
            return;
        }
        (async () => {
            try {
                const data = await getCronNextRuns(backups.cronExpr, TZ);
                setCronNextRuns(Array.isArray(data?.next) ? data.next.slice(0, 5) : null);
            } catch {
                setCronNextRuns(null);
            }
        })();
    }, [backups.schedule, backups.cronExpr]);

    /* ---------- UI helpers ---------- */
    const hasBlockingErrors = errors.length > 0;
    const typeLabel = (k: FanoutDest["kind"]) =>
        k === "remote" ? "Remote (SFTP)" :
            k === "gdrive" ? "Google Drive" :
                k === "nextcloud" ? "Nextcloud (WebDAV)" :
                    k.toUpperCase();

    /* ---------- actions ---------- */

    const saveConfig = async () => {
        const errs = validateConfig(backups);
        setErrors(errs);
        if (errs.length) {
            errs.forEach((e) => notify({ title: e, kind: "destructive", variant: "destructive" }));
            return;
        }
        setSaving(true);
        try {
            let destination: ApiDestination;
            switch (backups.destination.kind) {
                case "local":
                    destination = { kind: "local", path: (backups.destination as LocalDest).path };
                    break;
                case "s3":
                    destination = {
                        kind: "s3",
                        connectionId: (backups.destination as S3Dest).connectionId,
                        bucket: (backups.destination as S3Dest).bucket || undefined,
                        prefix: (backups.destination as S3Dest).prefix || undefined,
                    };
                    break;
                case "nextcloud":
                    destination = {
                        kind: "nextcloud",
                        connectionId: (backups.destination as NextcloudDest).connectionId,
                        path: (backups.destination as NextcloudDest).path,
                    };
                    break;
                case "gdrive":
                    destination = {
                        kind: "gdrive",
                        connectionId: (backups.destination as GDriveDest).connectionId,
                        subfolder: (backups.destination as GDriveDest).subfolder || undefined,
                    };
                    break;
                case "remote":
                default:
                    destination = {
                        kind: "remote",
                        connectionId: (backups.destination as RemoteSFTPDest).connectionId,
                        path: (backups.destination as RemoteSFTPDest).path,
                    };
                    break;
            }

            const payload: ApiBackupConfig & {
                extraDestinations?: FanoutDest[];
                minSuccess?: number;
                parallelism?: number;
            } = {
                enabled: backups.enabled,
                targets: backups.targets,
                schedule: backups.schedule,
                cronExpr: backups.cronExpr,
                retentionDays: Number(backups.retentionDays) || 0,
                encrypt: backups.encrypt,
                destination,
                extraDestinations: backups.extraDestinations,
                ...(backups.notifications ? { notifications: backups.notifications } : {}),
                ...(backups.minSuccess ? { minSuccess: Number(backups.minSuccess) } : {}),
                ...(backups.parallelism ? { parallelism: Number(backups.parallelism) } : {}),
            };

            await updateBackupConfig(payload as any);
            notify({ title: "Backup settings saved", kind: "success", variant: "success" });
            setErrors([]);
            await loadConfig();
        } catch (e: any) {
            notify({ title: e?.message || "Failed to save backup settings", kind: "destructive", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const runBackupNow = async () => {
        const errs = validateConfig(backups);
        if (!backups.enabled) errs.unshift("Enable backups before running.");
        if (errs.length) {
            errs.forEach((e) => notify({ title: e, kind: "destructive", variant: "destructive" }));
            setErrors(errs);
            return;
        }
        setRunning(true);
        try {
            const res = await apiRunBackupNow();
            if (res?.id) {
                const at = (res?.startedAt || new Date().toISOString()).slice(0, 16).replace("T", " ");
                setHistoryRaw((prev) => [{ id: res.id, at, status: "running" }, ...prev]);
            }
            notify({ title: "Backup started", kind: "default", variant: "default" });
        } catch (e: any) {
            notify({ title: e?.message || "Failed to start backup", kind: "destructive", variant: "destructive" });
        } finally {
            setRunning(false);
        }
    };

    const pruneNow = async () => {
        try {
            const res = await apiPruneBackups();
            const n = res?.removed ?? 0;
            notify({ title: `Prune complete: removed ${n} old archives`, kind: "default", variant: "default" });
            loadHistory(cursor);
        } catch (e: any) {
            notify({ title: e?.message || "Prune failed", kind: "destructive", variant: "destructive" });
        }
    };

    const testPrimaryDestination = async () => {
        const errs = validateDest(backups.destination as any);
        setErrors(errs);
        if (errs.length) {
            errs.forEach((e) => notify({ title: e, kind: "destructive", variant: "destructive" }));
            return;
        }
        setTestingDest(true);
        try {
            const res = await testBackupDestination(backups.destination as ApiDestination);
            const detail = res?.phases
                ? ` (${Object.entries(res.phases).map(([k, v]) => `${k}:${v ? "ok" : "fail"}`).join(", ")})`
                : "";
            notify({ title: `Destination OK${detail}`, kind: "success", variant: "success" });
        } catch (e: any) {
            notify({ title: e?.message || "Destination test failed", kind: "destructive", variant: "destructive" });
        } finally {
            setTestingDest(false);
        }
    };

    const retryJob = async (id: string) => {
        try {
            await retryBackup(id);
            notify({ title: `Retry queued for ${id}`, kind: "default", variant: "default" });
            loadHistory(cursor);
        } catch (e: any) {
            notify({ title: e?.message || "Retry failed", kind: "destructive", variant: "destructive" });
        }
    };

    const cancelJob = async (id: string) => {
        try {
            await cancelBackup(id);
            notify({ title: `Cancel sent to ${id}`, kind: "default", variant: "default" });
            loadHistory(cursor);
        } catch (e: any) {
            notify({ title: e?.message || "Cancel failed", kind: "destructive", variant: "destructive" });
        }
    };

    const downloadArchive = (id: string) => {
        window.open(`/api/admin/backups/${encodeURIComponent(id)}/download`, "_blank", "noopener,noreferrer");
    };
    const viewLog = (id: string) => {
        window.open(`/api/admin/backups/${encodeURIComponent(id)}/log`, "_blank", "noopener,noreferrer");
    };
    const viewManifest = (id: string) => {
        window.open(`/api/admin/backups/${encodeURIComponent(id)}/manifest`, "_blank", "noopener,noreferrer");
    };

    const confirmRestore = (id: string) => { setRestoreId(id); setRestoreConfirm(""); };
    const doRestore = async () => {
        if (!restoreId) return;
        try {
            await startRestore(restoreId);
            notify({ title: `Restore from ${restoreId} started`, kind: "default", variant: "default" });
        } catch (e: any) {
            notify({ title: e?.message || "Restore failed to start", kind: "destructive", variant: "destructive" });
        } finally {
            setRestoreId(null);
            setRestoreConfirm("");
        }
    };

    /* ---------- render ---------- */

    const scheduleNext = nextRunList;

    return (
        <TabsContent value="backups" className="mt-0">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ArchiveRestore className="h-5 w-5" />
                        Backups
                        <Badge variant={backups.enabled ? "default" : "secondary"} className="ml-1">
                            {backups.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                    </CardTitle>
                    <CardDescription>
                        Configure targets, schedule, retention, <b>multiple destinations</b> (Local / S3 / Nextcloud / Google Drive / SFTP), and notifications. Runs write to all selected destinations.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">

                    {errors.length > 0 && (
                        <div className="rounded-md border border-amber-300/60 bg-amber-50/40 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                            <div className="font-medium mb-1">Please review:</div>
                            <ul className="list-disc ml-5 space-y-0.5">
                                {errors.map((e, i) => (<li key={i}>{e}</li>))}
                            </ul>
                        </div>
                    )}

                    {/* Configuration */}
                    <div className="rounded-md border p-3 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Shield className="h-4 w-4" />
                                <div className="font-medium">Backup Configuration</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch checked={backups.enabled} onCheckedChange={(v) => setBackups({ ...backups, enabled: v })} />
                                <span className="text-sm">{backups.enabled ? "Enabled" : "Disabled"}</span>
                            </div>
                        </div>

                        {/* Targets */}
                        <div className="grid gap-2">
                            <Label className="text-sm">Targets</Label>
                            <div className="flex flex-wrap gap-2 text-sm">
                                {(["users", "roles", "devices", "policies", "audit_logs", "settings", "templates"] as BackupTarget[]).map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setBackups((prev) => ({
                                            ...prev,
                                            targets: prev.targets.includes(t)
                                                ? prev.targets.filter((x) => x !== t)
                                                : [...prev.targets, t],
                                        }))}
                                        className={cn(
                                            "rounded border px-2 py-1 capitalize",
                                            backups.targets.includes(t)
                                                ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20"
                                                : "border-border"
                                        )}
                                    >
                                        {t.replaceAll("_", " ")}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Schedule */}
                        <div className="grid gap-4">
                            <div className="grid gap-3 md:grid-cols-12">
                                <div className="grid gap-1 md:col-span-3">
                                    <Label className="text-sm">Schedule</Label>
                                    <Select
                                        value={backups.schedule}
                                        onValueChange={(v: ScheduleKind) => { setBackups({ ...backups, schedule: v }); setErrors([]); }}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Select schedule" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="hourly">Hourly</SelectItem>
                                            <SelectItem value="daily">Daily</SelectItem>
                                            <SelectItem value="weekly">Weekly</SelectItem>
                                            <SelectItem value="cron">Custom (cron)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="md:col-span-6">
                                    {backups.schedule === "cron" ? (
                                        <div className="space-y-2">
                                            <LabeledInput
                                                label="Cron expression"
                                                value={backups.cronExpr}
                                                onChange={(v) => { setBackups({ ...backups, cronExpr: v }); }}
                                            />
                                        </div>
                                    ) : (
                                        <div className="grid gap-1">
                                            <Label className="text-sm">Next runs (example)</Label>
                                            <Input readOnly value={(scheduleNext || []).slice(0, 5).join(" · ")} />
                                        </div>
                                    )}
                                </div>

                                <div className="grid gap-1 md:col-span-3">
                                    <LabeledNumber
                                        label="Retention (days)"
                                        value={backups.retentionDays}
                                        onChange={(v) => setBackups({ ...backups, retentionDays: v })}
                                    />
                                    {(!Number.isFinite(Number(backups.retentionDays)) ||
                                        Number(backups.retentionDays) < 1 ||
                                        Number(backups.retentionDays) > 3650) && (
                                            <span className="text-[11px] text-red-600">1–3650 days</span>
                                        )}
                                </div>
                            </div>

                            {backups.schedule === "cron" && (
                                <div className="md:col-span-12">
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {[{ label: "Every day 03:00", val: "0 3 * * *" },
                                        { label: "Every Sun 03:00", val: "0 3 * * 0" },
                                        { label: "Every hour", val: "0 * * * *" },
                                        { label: "Weekdays 02:00", val: "0 2 * * 1-5" }].map((p) => (
                                            <Button key={p.val} variant="outline" size="sm" onClick={() => setBackups({ ...backups, cronExpr: p.val })}>
                                                <ListChecks className="h-4 w-4 mr-1" /> {p.label}
                                            </Button>
                                        ))}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Next 5 runs:{" "}
                                        {isValidCron(backups.cronExpr)
                                            ? (cronNextRuns ? cronNextRuns.join(" · ") : "Cannot compute client-side; backend endpoint can provide preview.")
                                            : <span className="text-red-600">Invalid cron</span>}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Runner hints */}
                        <div className="grid md:grid-cols-6 gap-3">
                            <div className="md:col-span-3">
                                <LabeledNumber
                                    label="Min destinations that must succeed"
                                    value={backups.minSuccess ?? ""}
                                    onChange={(v) => setBackups({ ...backups, minSuccess: v })}
                                />
                            </div>
                            <div className="md:col-span-3">
                                <LabeledNumber
                                    label="Parallelism (workers)"
                                    value={backups.parallelism ?? ""}
                                    onChange={(v) => setBackups({ ...backups, parallelism: v })}
                                />
                            </div>
                        </div>

                        {/* PRIMARY Destination */}
                        <div className="rounded-md border p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="font-medium">Primary destination</div>
                                <div className="flex items-center gap-2">
                                    <Button type="button" variant="outline" size="sm" onClick={testPrimaryDestination} disabled={testingDest}>
                                        <RefreshCcw className="mr-2 h-4 w-4" />
                                        {testingDest ? "Testing..." : "Test destination"}
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" onClick={pruneNow}>
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Prune now
                                    </Button>
                                </div>
                            </div>

                            <div className="grid gap-3 md:grid-cols-12 items-start">
                                {/* Type */}
                                <div className="grid gap-1 md:col-span-3">
                                    <Label className="text-sm">Type</Label>
                                    <Select
                                        value={backups.destination.kind}
                                        onValueChange={(v: Dest["kind"]) => {
                                            if (v === "local") {
                                                setBackups({ ...backups, destination: { kind: "local", path: "/var/remoteiq/backups" } as LocalDest });
                                            } else if (v === "s3") {
                                                setBackups({ ...backups, destination: { kind: "s3", connectionId: "", bucket: "", prefix: "" } as S3Dest });
                                            } else if (v === "nextcloud") {
                                                setBackups({ ...backups, destination: { kind: "nextcloud", connectionId: "", path: "/Backups/RemoteIQ" } as NextcloudDest });
                                            } else if (v === "gdrive") {
                                                setBackups({ ...backups, destination: { kind: "gdrive", connectionId: "", subfolder: "" } as GDriveDest });
                                            } else {
                                                setBackups({ ...backups, destination: { kind: "remote", connectionId: "", path: "/srv/remoteiq/backups" } as RemoteSFTPDest });
                                            }
                                            setErrors([]);
                                        }}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="local">Local</SelectItem>
                                            <SelectItem value="s3">S3</SelectItem>
                                            <SelectItem value="nextcloud">Nextcloud (WebDAV)</SelectItem>
                                            <SelectItem value="gdrive">Google Drive</SelectItem>
                                            <SelectItem value="remote">Remote (SFTP)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Connection (if needed) */}
                                {backups.destination.kind !== "local" ? (
                                    <div className="grid gap-1 md:col-span-5">
                                        <Label className="text-sm">Connection</Label>
                                        <Select
                                            value={("connectionId" in backups.destination ? (backups.destination as any).connectionId : "") || ""}
                                            onValueChange={(v) => {
                                                setBackups((prev) => {
                                                    const d = prev.destination as any;
                                                    return { ...prev, destination: { ...d, connectionId: v } };
                                                });
                                                setErrors([]);
                                            }}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder={connsFor(backups.destination.kind).length ? "Select connection" : "No connections"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {connsFor(backups.destination.kind).map((c) => (
                                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                                ))}
                                                {connsFor(backups.destination.kind).length === 0 && (
                                                    <SelectItem value="__none" disabled>No connections</SelectItem>
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ) : (<div className="hidden md:block md:col-span-5" />)}

                                {/* Per-kind fields */}
                                {backups.destination.kind === "local" && (
                                    <div className="grid gap-1 md:col-span-4">
                                        <LabeledInput
                                            label="Directory (server path)"
                                            value={(backups.destination as LocalDest).path}
                                            onChange={(v) => setBackups({ ...backups, destination: { kind: "local", path: v } as LocalDest })}
                                            placeholder="/var/remoteiq/backups"
                                        />
                                    </div>
                                )}
                                {backups.destination.kind === "s3" && (
                                    <>
                                        <div className="md:col-span-2">
                                            <LabeledInput
                                                label="Bucket (override)"
                                                value={(backups.destination as S3Dest).bucket ?? ""}
                                                onChange={(v) => setBackups({ ...backups, destination: { ...(backups.destination as S3Dest), kind: "s3", bucket: v } as S3Dest })}
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <LabeledInput
                                                label="Prefix (override)"
                                                value={(backups.destination as S3Dest).prefix ?? ""}
                                                onChange={(v) => setBackups({ ...backups, destination: { ...(backups.destination as S3Dest), kind: "s3", prefix: v } as S3Dest })}
                                            />
                                        </div>
                                    </>
                                )}
                                {backups.destination.kind === "nextcloud" && (
                                    <div className="grid gap-1 md:col-span-4">
                                        <LabeledInput
                                            label="Folder path"
                                            value={(backups.destination as NextcloudDest).path}
                                            onChange={(v) => setBackups({ ...backups, destination: { ...(backups.destination as NextcloudDest), kind: "nextcloud", path: v } as NextcloudDest })}
                                            placeholder="/Backups/RemoteIQ"
                                        />
                                    </div>
                                )}
                                {backups.destination.kind === "gdrive" && (
                                    <div className="md:col-span-4">
                                        <LabeledInput
                                            label="Subfolder (optional)"
                                            value={(backups.destination as GDriveDest).subfolder ?? ""}
                                            onChange={(v) => setBackups({ ...backups, destination: { ...(backups.destination as GDriveDest), kind: "gdrive", subfolder: v } as GDriveDest })}
                                            placeholder="e.g., nightly-dumps"
                                        />
                                    </div>
                                )}
                                {backups.destination.kind === "remote" && (
                                    <div className="grid gap-1 md:col-span-4">
                                        <LabeledInput
                                            label="Directory (remote absolute path)"
                                            value={(backups.destination as RemoteSFTPDest).path}
                                            onChange={(v) => setBackups({ ...backups, destination: { ...(backups.destination as RemoteSFTPDest), kind: "remote", path: v } as RemoteSFTPDest })}
                                            placeholder="/srv/remoteiq/backups"
                                        />
                                    </div>
                                )}
                            </div>

                            <CheckToggle
                                label="Encrypt backup archives"
                                checked={backups.encrypt}
                                onChange={(v) => setBackups({ ...backups, encrypt: v })}
                            />
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Info className="h-3.5 w-3.5" /> Secrets live in Storage connections; the Backups UI never stores credentials.
                            </p>
                        </div>

                        {/* ADDITIONAL DESTINATIONS */}
                        <div className="rounded-md border p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="font-medium">Additional destinations (redundancy)</div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        setBackups((prev) => ({
                                            ...prev,
                                            extraDestinations: [...prev.extraDestinations, { kind: "s3", connectionId: "" }],
                                        }))
                                    }
                                >
                                    <Plus className="h-4 w-4 mr-1" /> Add destination
                                </Button>
                            </div>

                            {backups.extraDestinations.length === 0 ? (
                                <div className="text-xs text-muted-foreground">
                                    No additional destinations. Add S3, Nextcloud, Google Drive, SFTP or Local to write the same backup to multiple locations.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {backups.extraDestinations.map((d, i) => {
                                        const update = (patch: Partial<FanoutDest>) =>
                                            setBackups((prev) => {
                                                const arr = [...prev.extraDestinations];
                                                arr[i] = { ...arr[i], ...patch } as FanoutDest;
                                                return { ...prev, extraDestinations: arr };
                                            });
                                        const remove = () =>
                                            setBackups((prev) => {
                                                const arr = [...prev.extraDestinations];
                                                arr.splice(i, 1);
                                                return { ...prev, extraDestinations: arr };
                                            });

                                        const fields = (
                                            <>
                                                {/* Type */}
                                                <div className="grid gap-1 md:col-span-2">
                                                    <Label className="text-xs">Type</Label>
                                                    <Select
                                                        value={d.kind}
                                                        onValueChange={(v: FanoutDest["kind"]) => {
                                                            if (v === "local") update({ kind: "local", path: "/var/remoteiq/backups" });
                                                            else if (v === "s3") update({ kind: "s3", connectionId: "", bucket: "", prefix: "" });
                                                            else if (v === "nextcloud") update({ kind: "nextcloud", connectionId: "", path: "/Backups/RemoteIQ" });
                                                            else if (v === "gdrive") update({ kind: "gdrive", connectionId: "", subfolder: "" });
                                                            else update({ kind: "remote", connectionId: "", path: "/srv/remoteiq/backups" });
                                                        }}
                                                    >
                                                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="local">Local</SelectItem>
                                                            <SelectItem value="s3">S3</SelectItem>
                                                            <SelectItem value="nextcloud">Nextcloud</SelectItem>
                                                            <SelectItem value="gdrive">Google Drive</SelectItem>
                                                            <SelectItem value="remote">Remote (SFTP)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                {/* Connection if needed */}
                                                {d.kind !== "local" && (
                                                    <div className="grid gap-1 md:col-span-3">
                                                        <Label className="text-xs">Connection</Label>
                                                        <Select
                                                            value={("connectionId" in d ? (d as any).connectionId : "") || ""}
                                                            onValueChange={(v) => update({ ...(d as any), connectionId: v } as any)}
                                                        >
                                                            <SelectTrigger><SelectValue placeholder={connsFor(d.kind as any).length ? "Select connection" : "No connections"} /></SelectTrigger>
                                                            <SelectContent>
                                                                {connsFor(d.kind as any).map((c) => (
                                                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                                                ))}
                                                                {connsFor(d.kind as any).length === 0 && (
                                                                    <SelectItem value="__none" disabled>No connections</SelectItem>
                                                                )}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                )}

                                                {/* Per-kind fields */}
                                                {d.kind === "local" && (
                                                    <div className="grid gap-1 md:col-span-4">
                                                        <LabeledInput
                                                            label="Directory"
                                                            value={(d as any).path ?? ""}
                                                            onChange={(v) => update({ ...(d as any), path: v } as any)}
                                                            placeholder="/var/remoteiq/backups"
                                                        />
                                                    </div>
                                                )}
                                                {d.kind === "s3" && (
                                                    <>
                                                        <div className="md:col-span-2">
                                                            <LabeledInput
                                                                label="Bucket (override)"
                                                                value={(d as any).bucket ?? ""}
                                                                onChange={(v) => update({ ...(d as any), bucket: v } as any)}
                                                            />
                                                        </div>
                                                        <div className="md:col-span-2">
                                                            <LabeledInput
                                                                label="Prefix (override)"
                                                                value={(d as any).prefix ?? ""}
                                                                onChange={(v) => update({ ...(d as any), prefix: v } as any)}
                                                            />
                                                        </div>
                                                    </>
                                                )}
                                                {d.kind === "nextcloud" && (
                                                    <div className="grid gap-1 md:col-span-4">
                                                        <LabeledInput
                                                            label="Folder path"
                                                            value={(d as any).path ?? "/Backups/RemoteIQ"}
                                                            onChange={(v) => update({ ...(d as any), path: v } as any)}
                                                            placeholder="/Backups/RemoteIQ"
                                                        />
                                                    </div>
                                                )}
                                                {d.kind === "gdrive" && (
                                                    <div className="md:col-span-4">
                                                        <LabeledInput
                                                            label="Subfolder (optional)"
                                                            value={(d as any).subfolder ?? ""}
                                                            onChange={(v) => update({ ...(d as any), subfolder: v } as any)}
                                                            placeholder="e.g., nightly-dumps"
                                                        />
                                                    </div>
                                                )}
                                                {d.kind === "remote" && (
                                                    <div className="grid gap-1 md:col-span-4">
                                                        <LabeledInput
                                                            label="Directory"
                                                            value={(d as any).path ?? "/srv/remoteiq/backups"}
                                                            onChange={(v) => update({ ...(d as any), path: v } as any)}
                                                            placeholder="/srv/remoteiq/backups"
                                                        />
                                                    </div>
                                                )}

                                                {/* Priority */}
                                                <div className="md:col-span-2">
                                                    <LabeledNumber
                                                        label="Priority"
                                                        value={(d as any).priority ?? ((i + 2) * 10)}
                                                        onChange={(v) => update({ ...(d as any), priority: Number(v) as any })}
                                                    />
                                                </div>

                                                {/* Remove */}
                                                <div className="md:col-span-1 flex items-end">
                                                    <Button type="button" variant="ghost" onClick={remove} aria-label="Remove">
                                                        <Trash className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </>
                                        );

                                        return (
                                            <div key={i} className="grid md:grid-cols-12 gap-3 rounded-md border p-3">
                                                <div className="md:col-span-12 text-xs text-muted-foreground -mt-1 mb-1">
                                                    Destination #{i + 2} · <span className="font-medium">{typeLabel(d.kind)}</span>
                                                </div>
                                                {fields}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Notifications */}
                        <div className="rounded-md border p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="font-medium">Notifications</div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        (async () => {
                                            try {
                                                await fetch("/api/admin/backups/test-notification", { method: "POST" });
                                                notify({ title: "Notification test sent", kind: "success", variant: "success" });
                                            } catch (e: any) {
                                                notify({ title: e?.message || "Notification test failed", kind: "destructive", variant: "destructive" });
                                            }
                                        })();
                                    }}
                                >
                                    <RefreshCcw className="mr-2 h-4 w-4" /> Test notification
                                </Button>
                            </div>
                            <div className="flex gap-6">
                                <CheckToggle
                                    label="Email"
                                    checked={!!backups.notifications?.email}
                                    onChange={(v) => setBackups({ ...backups, notifications: { ...backups.notifications, email: v } })}
                                />
                                <CheckToggle
                                    label="Slack"
                                    checked={!!backups.notifications?.slack}
                                    onChange={(v) => setBackups({ ...backups, notifications: { ...backups.notifications, slack: v } })}
                                />
                                <CheckToggle
                                    label="Webhook"
                                    checked={!!backups.notifications?.webhook}
                                    onChange={(v) => setBackups({ ...backups, notifications: { ...backups.notifications, webhook: v } })}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Configure endpoints/recipients on the server. UI only toggles which events to notify.
                            </p>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="rounded-md border p-3 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Filter className="h-4 w-4" /> Filters
                        </div>
                        <div className="grid md:grid-cols-4 gap-3">
                            <div className="grid gap-1">
                                <Label className="text-sm">Status</Label>
                                <Select value={statusFilter} onValueChange={(v: HistoryStatus) => setStatusFilter(v)}>
                                    <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="any">Any</SelectItem>
                                        <SelectItem value="success">Success</SelectItem>
                                        <SelectItem value="failed">Failed</SelectItem>
                                        <SelectItem value="running">Running</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-1">
                                <Label className="text-sm">From (YYYY-MM-DD)</Label>
                                <Input value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="2025-10-01" />
                            </div>
                            <div className="grid gap-1">
                                <Label className="text-sm">To (YYYY-MM-DD)</Label>
                                <Input value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="2025-10-31" />
                            </div>
                            <div className="grid gap-1">
                                <Label className="text-sm">Search (ID or note)</Label>
                                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. permission denied" />
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <Button
                                variant="outline"
                                onClick={() => { setStatusFilter("any"); setDateFrom(""); setDateTo(""); setSearch(""); }}
                            >
                                Reset
                            </Button>
                            <Button onClick={() => { setCursor(null); setCursorStack([]); loadHistory(null); }}>
                                Apply
                            </Button>
                        </div>
                    </div>

                    {/* History */}
                    <div className="rounded-md border">
                        <div className="grid grid-cols-12 border-b bg-muted/30 p-2 text-xs font-medium text-muted-foreground">
                            <div className="col-span-2 px-2">ID</div>
                            <div className="col-span-2 px-2">Time</div>
                            <div className="col-span-2 px-2">Status</div>
                            <div className="col-span-2 px-2">Size / Duration</div>
                            <div className="col-span-2 px-2">Note</div>
                            <div className="col-span-2 px-2 text-right">Actions</div>
                        </div>

                        {historyLoading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="grid grid-cols-12 items-center border-b p-2 last:border-b-0">
                                    <div className="col-span-2 px-2"><Skeleton className="h-4 w-24" /></div>
                                    <div className="col-span-2 px-2"><Skeleton className="h-4 w-28" /></div>
                                    <div className="col-span-2 px-2"><Skeleton className="h-4 w-16" /></div>
                                    <div className="col-span-2 px-2"><Skeleton className="h-4 w-24" /></div>
                                    <div className="col-span-2 px-2"><Skeleton className="h-4 w-36" /></div>
                                    <div className="col-span-2 px-2 text-right"><Skeleton className="h-8 w-48 ml-auto" /></div>
                                </div>
                            ))
                        ) : historyView.length === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground">No backups found.</div>
                        ) : (
                            historyView.map((b) => {
                                const verified = (b as any).verified ? true : false;
                                const size = (b as any).sizeBytes != null ? `${Math.round((b as any).sizeBytes / 1024 / 1024)} MB` : "—";
                                const dur = (b as any).durationSec != null ? `${Math.round((b as any).durationSec)}s` : "—";
                                return (
                                    <div key={b.id} className="grid grid-cols-12 items-center border-b p-2 last:border-b-0 text-sm">
                                        <div className="col-span-2 px-2 font-mono flex items-center gap-2">
                                            {b.id}{verified ? (<Badge variant="secondary">Verified</Badge>) : null}
                                        </div>
                                        <div className="col-span-2 px-2">{b.at}</div>
                                        <div className={cn(
                                            "col-span-2 px-2 capitalize",
                                            b.status === "success" ? "text-emerald-600"
                                                : b.status === "failed" ? "text-red-600"
                                                    : b.status === "running" ? "text-amber-600"
                                                        : "text-muted-foreground"
                                        )}>
                                            {b.status}
                                        </div>
                                        <div className="col-span-2 px-2 text-muted-foreground">{size} / {dur}</div>
                                        <div className="col-span-2 px-2 text-muted-foreground min-w-0 overflow-hidden">
                                            <span className="inline-block w-full overflow-hidden text-ellipsis whitespace-nowrap" title={b.note ?? ""}>
                                                {b.note ?? "—"}
                                            </span>
                                        </div>
                                        <div className="col-span-2 px-2 text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="outline" size="sm" aria-label="Actions">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>

                                                <DropdownMenuContent align="end" className="w-44">
                                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                    <DropdownMenuItem onClick={() => viewLog(b.id)}>
                                                        <FileText className="h-4 w-4 mr-2" /> View log
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => viewManifest(b.id)}>
                                                        <Info className="h-4 w-4 mr-2" /> Manifest
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => downloadArchive(b.id)}
                                                        disabled={b.status !== "success" || !perms.download}
                                                    >
                                                        <Download className="h-4 w-4 mr-2" /> Download
                                                    </DropdownMenuItem>

                                                    {b.status === "failed" && (
                                                        <DropdownMenuItem onClick={() => retryJob(b.id)}>
                                                            <Repeat2 className="h-4 w-4 mr-2" /> Retry
                                                        </DropdownMenuItem>
                                                    )}
                                                    {b.status === "running" && (
                                                        <DropdownMenuItem onClick={() => cancelJob(b.id)}>
                                                            <XCircle className="h-4 w-4 mr-2" /> Cancel
                                                        </DropdownMenuItem>
                                                    )}

                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() => confirmRestore(b.id)}
                                                        disabled={b.status !== "success" || !perms.restore}
                                                    >
                                                        <RotateCcw className="h-4 w-4 mr-2" /> Restore
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">Timezone: {TZ}</div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                disabled={cursorStack.length === 0}
                                onClick={() => {
                                    const prev = [...cursorStack];
                                    const last = prev.pop();
                                    setCursorStack(prev);
                                    setCursor(last ?? null);
                                }}
                            >
                                Prev
                            </Button>
                            <Button
                                variant="outline"
                                disabled={!nextCursor}
                                onClick={() => {
                                    if (nextCursor) {
                                        setCursorStack((s) => [...s, cursor ?? ""]);
                                        setCursor(nextCursor);
                                    }
                                }}
                            >
                                Next
                            </Button>
                        </div>
                    </div>

                    {/* Footer actions */}
                    <div className="flex items-center justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={runBackupNow}
                            disabled={running || !backups.enabled || hasBlockingErrors}
                        >
                            <RefreshCcw className="mr-2 h-4 w-4" />
                            {running ? "Starting…" : "Run backup now"}
                        </Button>
                        <Button variant="success" onClick={saveConfig} disabled={saving || hasBlockingErrors}>
                            {saving ? "Saving…" : "Save backup settings"}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Restore confirm dialog */}
            <AlertDialog open={!!restoreId} onOpenChange={(open) => !open && setRestoreId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Restore from backup?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will start a restore job from <span className="font-mono">{restoreId}</span>.
                            <br />
                            Type <span className="font-semibold">RESTORE</span> to confirm.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="px-6">
                        <Input value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)} placeholder="RESTORE" />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={doRestore} disabled={restoreConfirm !== "RESTORE"}>
                            Start Restore
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </TabsContent>
    );
}
