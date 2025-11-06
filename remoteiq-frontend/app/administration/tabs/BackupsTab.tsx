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
    XCircle, Repeat2, Filter, Trash2, Info, ListChecks, MoreVertical,
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

interface BackupsTabProps {
    push?: (opts: ToastOptions) => void;
}

type HistoryStatus = "any" | "success" | "failed" | "running";

type ConfigState = {
    enabled: boolean;
    targets: BackupTarget[];
    schedule: ScheduleKind;
    cronExpr: string;
    retentionDays: number | "";
    encrypt: boolean;
    destination: Dest;
    notifications?: { email?: boolean; webhook?: boolean; slack?: boolean };
};

const TZ = "America/New_York";

/* -------------------------- helpers -------------------------- */

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
            let cursor = new Date(localNow);
            cursor.setHours(3, 0, 0, 0);
            const day = cursor.getDay();
            const add = (7 - day) % 7 || (localNow >= cursor ? 7 : 0);
            cursor.setDate(cursor.getDate() + add);
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

function validateConfig(c: ConfigState): string[] {
    const errs: string[] = [];
    const days = Number(c.retentionDays);
    if (!Number.isFinite(days) || days < 1 || days > 3650)
        errs.push("Retention days must be between 1 and 3650.");
    if (c.schedule === "cron" && !isValidCron(c.cronExpr))
        errs.push("Cron expression looks invalid.");
    if (!c.targets.length) errs.push("Select at least one backup target.");

    switch (c.destination.kind) {
        case "local": {
            const p = c.destination.path.trim();
            if (!p) errs.push("Local backup directory is required.");
            else {
                const abs = p.startsWith("/") || /^[A-Za-z]:\\/.test(p);
                if (!abs) errs.push("Local backup directory must be an absolute path.");
                if (p.includes("..") || p.includes("\0"))
                    errs.push("Local backup directory cannot contain '..' or NUL.");
            }
            break;
        }
        case "s3":
            if (!c.destination.connectionId) errs.push("Select an S3 connection.");
            break;
        case "nextcloud":
            if (!c.destination.connectionId) errs.push("Select a Nextcloud connection.");
            if (!(c.destination.path?.trim() ?? "").startsWith("/"))
                errs.push("Nextcloud folder path should start with '/'.");
            break;
        case "gdrive":
            if (!c.destination.connectionId) errs.push("Select a Google Drive connection.");
            break;
        case "remote": {
            if (!c.destination.connectionId) errs.push("Select an SFTP connection.");
            const path = c.destination.path?.trim() ?? "";
            const abs = path.startsWith("/") || /^[A-Za-z]:\\/.test(path);
            if (!path) errs.push("Remote directory path is required.");
            else if (!abs) errs.push("Remote directory path must be an absolute path.");
            break;
        }
    }

    return errs;
}

/* -------------------------- component -------------------------- */

export default function BackupsTab({ push }: BackupsTabProps) {
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
        targets: [] as BackupTarget[],                // start empty; no assumptions
        schedule: "daily",
        cronExpr: "0 3 * * *",
        retentionDays: 30,
        encrypt: true,
        destination: { kind: "local", path: "/var/remoteiq/backups" } as LocalDest,
        notifications: { email: false, webhook: false, slack: false },
    });

    // SAFE defaults – no phantom capabilities
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

    // filters
    const [statusFilter, setStatusFilter] = React.useState<HistoryStatus>("any");
    const [search, setSearch] = React.useState("");
    const [dateFrom, setDateFrom] = React.useState<string>("");
    const [dateTo, setDateTo] = React.useState<string>("");

    const nextRunList = humanNextRun(backups.schedule);
    const [cronNextRuns, setCronNextRuns] = React.useState<string[] | null>(null);

    /* ---------- load config + perms + connections ---------- */
    const loadConfig = React.useCallback(async () => {
        try {
            const cfg = await getBackupConfig();
            const inDest: any = (cfg as any).destination || {};
            let dest: Dest;

            switch (inDest.kind) {
                case "s3":
                    dest = { kind: "s3", connectionId: inDest.connectionId ?? "", bucket: inDest.bucket ?? "", prefix: inDest.prefix ?? "" } as S3Dest;
                    setSelectedConnId(inDest.connectionId ?? "");
                    break;
                case "nextcloud":
                    dest = { kind: "nextcloud", connectionId: inDest.connectionId ?? "", path: inDest.path ?? "/Backups/RemoteIQ" } as NextcloudDest;
                    setSelectedConnId(inDest.connectionId ?? "");
                    break;
                case "gdrive":
                    dest = { kind: "gdrive", connectionId: inDest.connectionId ?? "", subfolder: inDest.subfolder ?? "" } as GDriveDest;
                    setSelectedConnId(inDest.connectionId ?? "");
                    break;
                case "remote":
                    dest = { kind: "remote", connectionId: inDest.connectionId ?? "", path: inDest.path ?? "/srv/remoteiq/backups" } as RemoteSFTPDest;
                    setSelectedConnId(inDest.connectionId ?? "");
                    break;
                case "local":
                default:
                    dest = { kind: "local", path: inDest.path ?? "/var/remoteiq/backups" } as LocalDest;
            }

            setBackups({
                enabled: cfg.enabled,
                targets: (cfg.targets as BackupTarget[]) ?? [],
                schedule: (cfg.schedule as ScheduleKind) ?? "daily",
                cronExpr: cfg.cronExpr || "0 3 * * *",
                retentionDays: typeof cfg.retentionDays === "number" ? cfg.retentionDays : 30,
                encrypt: !!cfg.encrypt,
                destination: dest,
                notifications: (cfg as any).notifications ?? { email: false, webhook: false, slack: false },
            });
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
            // keep restrictive defaults
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

    /* ---------- fetch history (NO DUMMY FALLBACK) ---------- */
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
                // absolutely no fabricated rows
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

    /* ---------- client-side filtering ---------- */
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
                        connectionId: selectedConnId || (backups.destination as S3Dest).connectionId,
                        bucket: (backups.destination as S3Dest).bucket || undefined,
                        prefix: (backups.destination as S3Dest).prefix || undefined,
                    };
                    break;
                case "nextcloud":
                    destination = {
                        kind: "nextcloud",
                        connectionId: selectedConnId || (backups.destination as NextcloudDest).connectionId,
                        path: (backups.destination as NextcloudDest).path,
                    };
                    break;
                case "gdrive":
                    destination = {
                        kind: "gdrive",
                        connectionId: selectedConnId || (backups.destination as GDriveDest).connectionId,
                        subfolder: (backups.destination as GDriveDest).subfolder || undefined,
                    };
                    break;
                case "remote":
                default:
                    destination = {
                        kind: "remote",
                        connectionId: selectedConnId || (backups.destination as RemoteSFTPDest).connectionId,
                        path: (backups.destination as RemoteSFTPDest).path,
                    };
                    break;
            }

            const payload: ApiBackupConfig = {
                enabled: backups.enabled,
                targets: backups.targets,
                schedule: backups.schedule,
                cronExpr: backups.cronExpr,
                retentionDays: Number(backups.retentionDays) || 0,
                encrypt: backups.encrypt,
                destination,
                ...(backups.notifications ? { notifications: backups.notifications } : {}),
            };

            await updateBackupConfig(payload);
            notify({ title: "Backup settings saved", kind: "success", variant: "success" });
            setErrors([]);
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
            // Only add an optimistic row if the server returned an id
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

    const testDestination = async () => {
        const errs = validateConfig(backups).filter((e) => !e.toLowerCase().includes("retention"));
        setErrors(errs);
        if (errs.length) {
            errs.forEach((e) => notify({ title: e, kind: "destructive", variant: "destructive" }));
            return;
        }
        setTestingDest(true);
        try {
            let destination: ApiDestination;
            switch (backups.destination.kind) {
                case "local":
                    destination = { kind: "local", path: (backups.destination as LocalDest).path };
                    break;
                case "s3":
                    destination = {
                        kind: "s3",
                        connectionId: selectedConnId || (backups.destination as S3Dest).connectionId,
                        bucket: (backups.destination as S3Dest).bucket || undefined,
                        prefix: (backups.destination as S3Dest).prefix || undefined,
                    };
                    break;
                case "nextcloud":
                    destination = {
                        kind: "nextcloud",
                        connectionId: selectedConnId || (backups.destination as NextcloudDest).connectionId,
                        path: (backups.destination as NextcloudDest).path,
                    };
                    break;
                case "gdrive":
                    destination = {
                        kind: "gdrive",
                        connectionId: selectedConnId || (backups.destination as GDriveDest).connectionId,
                        subfolder: (backups.destination as GDriveDest).subfolder || undefined,
                    };
                    break;
                case "remote":
                default:
                    destination = {
                        kind: "remote",
                        connectionId: selectedConnId || (backups.destination as RemoteSFTPDest).connectionId,
                        path: (backups.destination as RemoteSFTPDest).path,
                    };
                    break;
            }

            const res = await testBackupDestination(destination);
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

    const connsFor = (k: Dest["kind"]) => {
        const map: Record<Dest["kind"], StorageKind | null> = {
            local: null, s3: "s3", nextcloud: "nextcloud", gdrive: "gdrive", remote: "sftp",
        };
        const want = map[k];
        if (!want) return [];
        return connAll.filter((c) => c.kind === want);
    };

    const hasBlockingErrors = errors.length > 0;

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
                        Configure backup targets, schedule, retention, destination (Local / S3 / Nextcloud / Google Drive / Remote SFTP), notifications, and manage history.
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
                            {!backups.targets.length && (
                                <div className="text-[11px] text-red-600">Select at least one target.</div>
                            )}
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
                                            <Input readOnly value={(nextRunList || []).slice(0, 5).join(" · ")} />
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
                                        {[
                                            { label: "Every day 03:00", val: "0 3 * * *" },
                                            { label: "Every Sun 03:00", val: "0 3 * * 0" },
                                            { label: "Every hour", val: "0 * * * *" },
                                            { label: "Weekdays 02:00", val: "0 2 * * 1-5" },
                                        ].map((p) => (
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

                        {/* Destination */}
                        <div className="rounded-md border p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="font-medium">Destination</div>
                                <div className="flex items-center gap-2">
                                    <Button type="button" variant="outline" size="sm" onClick={testDestination} disabled={testingDest}>
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
                                                setBackups({ ...backups, destination: { kind: "s3", connectionId: selectedConnId || "", bucket: "", prefix: "" } as S3Dest });
                                            } else if (v === "nextcloud") {
                                                setBackups({ ...backups, destination: { kind: "nextcloud", connectionId: selectedConnId || "", path: "/Backups/RemoteIQ" } as NextcloudDest });
                                            } else if (v === "gdrive") {
                                                setBackups({ ...backups, destination: { kind: "gdrive", connectionId: selectedConnId || "", subfolder: "" } as GDriveDest });
                                            } else {
                                                setBackups({ ...backups, destination: { kind: "remote", connectionId: selectedConnId || "", path: "/srv/remoteiq/backups" } as RemoteSFTPDest });
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

                                {/* Connection */}
                                {backups.destination.kind !== "local" ? (
                                    <div className="grid gap-1 md:col-span-5">
                                        <Label className="text-sm">Connection</Label>
                                        <Select
                                            value={selectedConnId}
                                            onValueChange={(v) => {
                                                setSelectedConnId(v);
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
                                        <p className="text-xs text-muted-foreground leading-tight">
                                            Manage connections in the <span className="font-medium">Storage</span> tab.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="hidden md:block md:col-span-5" />
                                )}

                                {/* Per-kind fields */}
                                {backups.destination.kind === "local" && (
                                    <div className="grid gap-1 md:col-span-4">
                                        <LabeledInput
                                            label="Directory (server path)"
                                            value={(backups.destination as LocalDest).path}
                                            onChange={(v) => {
                                                setBackups({ ...backups, destination: { kind: "local", path: v } as LocalDest });
                                                setErrors([]);
                                            }}
                                            placeholder="/var/remoteiq/backups"
                                        />
                                        {!((backups.destination as LocalDest).path && /^(\/|[A-Za-z]:\\)/.test((backups.destination as LocalDest).path)) && (
                                            <span className="text-[11px] text-muted-foreground">Absolute path required.</span>
                                        )}
                                    </div>
                                )}

                                {backups.destination.kind === "s3" && (
                                    <>
                                        <div className="md:col-span-2">
                                            <LabeledInput
                                                label="Bucket (override)"
                                                value={(backups.destination as S3Dest).bucket ?? ""}
                                                onChange={(v) => {
                                                    setBackups({
                                                        ...backups,
                                                        destination: { ...(backups.destination as S3Dest), kind: "s3", bucket: v } as S3Dest,
                                                    });
                                                    setErrors([]);
                                                }}
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <LabeledInput
                                                label="Prefix (override)"
                                                value={(backups.destination as S3Dest).prefix ?? ""}
                                                onChange={(v) => {
                                                    setBackups({
                                                        ...backups,
                                                        destination: { ...(backups.destination as S3Dest), kind: "s3", prefix: v } as S3Dest,
                                                    });
                                                    setErrors([]);
                                                }}
                                            />
                                        </div>
                                    </>
                                )}

                                {backups.destination.kind === "nextcloud" && (
                                    <div className="grid gap-1 md:col-span-4">
                                        <LabeledInput
                                            label="Folder path"
                                            value={(backups.destination as NextcloudDest).path}
                                            onChange={(v) => {
                                                setBackups({
                                                    ...backups,
                                                    destination: { ...(backups.destination as NextcloudDest), kind: "nextcloud", path: v } as NextcloudDest,
                                                });
                                                setErrors([]);
                                            }}
                                            placeholder="/Backups/RemoteIQ"
                                        />
                                        {!((backups.destination as NextcloudDest).path || "").startsWith("/") && (
                                            <span className="text-[11px] text-red-600">Should start with &#39;/&#39;.</span>
                                        )}
                                    </div>
                                )}

                                {backups.destination.kind === "gdrive" && (
                                    <div className="md:col-span-4">
                                        <LabeledInput
                                            label="Subfolder (optional)"
                                            value={(backups.destination as GDriveDest).subfolder ?? ""}
                                            onChange={(v) => {
                                                setBackups({
                                                    ...backups,
                                                    destination: { ...(backups.destination as GDriveDest), kind: "gdrive", subfolder: v } as GDriveDest,
                                                });
                                                setErrors([]);
                                            }}
                                            placeholder="e.g., nightly-dumps"
                                        />
                                    </div>
                                )}

                                {backups.destination.kind === "remote" && (
                                    <div className="grid gap-1 md:col-span-4">
                                        <LabeledInput
                                            label="Directory (remote absolute path)"
                                            value={(backups.destination as RemoteSFTPDest).path}
                                            onChange={(v) => {
                                                setBackups({
                                                    ...backups,
                                                    destination: { ...(backups.destination as RemoteSFTPDest), kind: "remote", path: v } as RemoteSFTPDest,
                                                });
                                                setErrors([]);
                                            }}
                                            placeholder="/srv/remoteiq/backups"
                                        />
                                        {!(backups.destination as RemoteSFTPDest).path && (
                                            <span className="text-[11px] text-red-600">Path required.</span>
                                        )}
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
