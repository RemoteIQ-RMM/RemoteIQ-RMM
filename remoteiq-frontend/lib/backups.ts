// remoteiq-frontend/lib/backups.ts

import { jfetch } from "@/lib/api";

export type StorageKind = "s3" | "nextcloud" | "gdrive" | "sftp";
export type ConnectionLite = { id: string; name: string; kind: StorageKind };

export type BackupTarget =
    | "users"
    | "roles"
    | "devices"
    | "policies"
    | "audit_logs"
    | "settings"
    | "templates";

export type HistoryStatus = "any" | "success" | "failed" | "running";

export type BackupHistoryRow = {
    id: string;
    at: string; // "YYYY-MM-DD HH:mm"
    status: "success" | "failed" | "running";
    note?: string;
    sizeBytes?: number;
    durationSec?: number;
    verified?: boolean;
};

export type ScheduleKind = "hourly" | "daily" | "weekly" | "cron";

// Destinations
export type LocalDest = { kind: "local"; path: string };
export type S3Dest = {
    kind: "s3";
    connectionId: string;
    bucket?: string;
    prefix?: string;
};
export type NextcloudDest = {
    kind: "nextcloud";
    connectionId: string;
    path: string;
};
export type GDriveDest = {
    kind: "gdrive";
    connectionId: string;
    subfolder?: string;
};
export type RemoteSFTPDest = {
    kind: "remote";
    connectionId: string;
    path: string;
};

export type Destination =
    | LocalDest
    | S3Dest
    | NextcloudDest
    | GDriveDest
    | RemoteSFTPDest;

// Fanout destinations (match BackupsTab usage)
export type FanoutDest =
    | { kind: "local"; path: string; isPrimary?: boolean; priority?: number }
    | { kind: "s3"; connectionId: string; bucket?: string; prefix?: string; isPrimary?: boolean; priority?: number }
    | { kind: "nextcloud"; connectionId: string; path: string; isPrimary?: boolean; priority?: number }
    | { kind: "gdrive"; connectionId: string; subfolder?: string; isPrimary?: boolean; priority?: number }
    | { kind: "remote"; connectionId: string; path: string; isPrimary?: boolean; priority?: number };

export type BackupConfig = {
    enabled: boolean;
    targets: BackupTarget[];
    schedule: ScheduleKind;
    cronExpr?: string;
    retentionDays: number;
    encrypt: boolean;

    // Primary destination (required)
    destination: Destination;

    // 🔥 Added to match UI
    extraDestinations?: FanoutDest[];
    minSuccess?: number;
    parallelism?: number;

    notifications?: { email?: boolean; webhook?: boolean; slack?: boolean };
};

export type Permissions = { restore: boolean; download: boolean };

// ---- API: Config / Permissions ----
export async function getBackupConfig() {
    return jfetch<BackupConfig>("/api/admin/backups/config");
}

export async function updateBackupConfig(cfg: BackupConfig) {
    return jfetch("/api/admin/backups/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: cfg,
    });
}

export async function getBackupPermissions() {
    return jfetch<Permissions>("/api/admin/backups/permissions");
}

// ---- API: Storage connections (lite for pickers) ----
export async function listStorageConnectionsLite() {
    // If the endpoint returns full objects, consider adding a `?lite=1` on the backend,
    // or map client-side to {id,name,kind} only. Type now reflects the lite shape.
    return jfetch<{ items: ConnectionLite[] }>("/api/admin/storage/connections");
}

// ---- API: History ----
export async function listBackupHistory(params: {
    cursor?: string | null;
    status?: Exclude<HistoryStatus, "any">;
    q?: string;
    from?: string; // YYYY-MM-DD
    to?: string;   // YYYY-MM-DD
}) {
    const qs = new URLSearchParams();
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.status) qs.set("status", params.status);
    if (params.q?.trim()) qs.set("q", params.q.trim());
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);

    return jfetch<{ items: BackupHistoryRow[]; nextCursor?: string }>(
        `/api/admin/backups/history?${qs.toString()}`
    );
}

// ---- API: Actions ----
export async function runBackupNow() {
    return jfetch<{ id: string; startedAt: string }>("/api/admin/backups/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
}

export async function pruneBackups() {
    return jfetch<{ removed?: number }>("/api/admin/backups/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
}

export async function testBackupDestination(destination: Destination) {
    return jfetch<{ ok: boolean; phases?: Record<string, boolean> }>(
        "/api/admin/backups/test-destination",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: { destination },
        }
    );
}

export async function retryBackup(id: string) {
    return jfetch(`/api/admin/backups/${encodeURIComponent(id)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
}

export async function cancelBackup(id: string) {
    return jfetch(`/api/admin/backups/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
}

export async function startRestore(id: string) {
    return jfetch(`/api/admin/backups/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
}

export async function getCronNextRuns(cronExpr: string, tz: string) {
    return jfetch<{ next: string[] }>(
        `/api/admin/backups/next-runs?cron=${encodeURIComponent(cronExpr)}&tz=${encodeURIComponent(tz)}`
    );
}
