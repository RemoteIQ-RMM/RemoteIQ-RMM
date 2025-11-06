// lib/storage.ts
import { jfetch } from "@/lib/api";

/* ===== Shared types for Storage ===== */
export type StorageKind = "s3" | "nextcloud" | "gdrive" | "sftp";
export type Env = "dev" | "staging" | "prod";

export type Capabilities = {
    canUse?: boolean;
    canEdit?: boolean;
    canRotate?: boolean;
    canDelete?: boolean;
};
export type Health = {
    status?: "healthy" | "unhealthy" | "unknown";
    lastCheckedAt?: string;
    lastResult?: string;
};

export type ConnectionMeta = {
    environment?: Env;
    tags?: string[];
    defaultFor?: { backups?: boolean; exports?: boolean; artifacts?: boolean };
    bandwidthLimitMBps?: number;
    concurrency?: number;
    compression?: "none" | "gzip" | "zstd";
    encryptionAtRest?: boolean;
    createdBy?: string;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type S3ConnConfig = {
    provider: "aws" | "minio" | "wasabi" | "other";
    region: string;
    bucket: string;
    endpoint?: string;
    prefix?: string;
    pathStyle?: boolean;
    sse?: "none" | "AES256" | "aws:kms";
    kmsKeyId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    roleArn?: string;
    externalId?: string;
    sessionDurationSec?: number;
    bucketLifecycleSummary?: string;
};
export type NextcloudConnConfig = {
    webdavUrl: string;
    username: string;
    password?: string;
    path: string;
    _browse?: string[];
};
export type GDriveConnConfig = {
    folderId: string;
    accountEmail?: string;
    authMode?: "OAuth" | "ServiceAccount";
};
export type SftpConnConfig = {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPem?: string;
    passphrase?: string;
    hostKeyFingerprint?: string;
    path: string;
};

export type StorageConnection = {
    id: string;
    name: string;
    kind: StorageKind;
    config: S3ConnConfig | NextcloudConnConfig | GDriveConnConfig | SftpConnConfig;
    meta?: ConnectionMeta;
    health?: Health;
    capabilities?: Capabilities;
    hasSecret?: {
        s3Credentials?: boolean;
        nextcloudPassword?: boolean;
        sftpPassword?: boolean;
        sftpPrivateKey?: boolean;
    };
};

export type ListResp = { items: StorageConnection[] };
export type DependentsResp = { features: { name: string; ids?: string[] }[] };

/* ===== API helpers ===== */
export async function listStorageConnections(): Promise<ListResp> {
    return await jfetch<ListResp>("/api/admin/storage/connections");
}

export async function createStorageConnection(payload: {
    name: string;
    kind: StorageKind;
    config: StorageConnection["config"];
    meta?: ConnectionMeta;
}): Promise<{ id: string }> {
    return await jfetch("/api/admin/storage/connections", {
        method: "POST",
        body: payload,
    });
}

export async function updateStorageConnection(
    id: string,
    payload: {
        name: string;
        kind: StorageKind;
        config: StorageConnection["config"];
        meta?: ConnectionMeta;
    }
): Promise<void> {
    await jfetch(`/api/admin/storage/connections/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: payload,
    });
}

export async function deleteStorageConnection(id: string): Promise<void> {
    await jfetch(`/api/admin/storage/connections/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });
}

export async function getStorageDependents(id: string): Promise<DependentsResp> {
    return await jfetch(
        `/api/admin/storage/connections/${encodeURIComponent(id)}/dependents`
    );
}

export async function testStorageConnection(body: {
    kind: StorageKind;
    config: StorageConnection["config"];
    meta?: ConnectionMeta;
    probe?: "write-read-delete" | "read";
}): Promise<{ ok: boolean; phases?: Record<string, boolean>; detail?: string }> {
    return await jfetch("/api/admin/storage/test", {
        method: "POST",
        body,
    });
}

export async function browseNextcloud(body: {
    config: NextcloudConnConfig;
    path: string;
}): Promise<{ ok: boolean; dirs?: string[]; error?: string }> {
    return await jfetch("/api/admin/storage/browse", {
        method: "POST",
        body: { kind: "nextcloud", ...body },
    });
}
