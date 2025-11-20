import {
    S3Client,
    PutObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import SftpClient from "ssh2-sftp-client";
import { createClient as createWebdavClient } from "webdav";
import { google } from "googleapis";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import type { Readable as NodeReadable } from "stream";

/* ---------------- Types ---------------- */
export type LocalLoc = { kind: "local"; path: string };
export type S3Loc = { kind: "s3"; bucket: string; key: string; region?: string; endpoint?: string };
export type ArtifactLoc = LocalLoc | S3Loc;

export type S3Secret = {
    region?: string;
    bucket?: string;
    endpoint?: string; // optional for compatible S3 (e.g., MinIO, Wasabi)
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    forcePathStyle?: boolean;
    kmsKeyId?: string; // reserved
};

export async function ensureDir(p: string) {
    await fsp.mkdir(p, { recursive: true });
}

/* ---------------- Small path helpers (WebDAV-safe) ---------------- */
function ensureLeadingSlash(p: string) {
    return p.startsWith("/") ? p : `/${p}`;
}
function ensureTrailingSlash(p: string) {
    return p.endsWith("/") ? p : `${p}/`;
}
function collapseSlashes(p: string) {
    return p.replace(/\/{2,}/g, "/");
}
function normalizeDirPath(p: string) {
    return collapseSlashes(ensureTrailingSlash(ensureLeadingSlash(p || "/")));
}
function normalizeFilePath(p: string) {
    const withLead = ensureLeadingSlash(p || "/");
    const noTrail = collapseSlashes(withLead).replace(/\/+$/g, "");
    return noTrail.length ? noTrail : "/";
}

/* ---------------- Local ---------------- */
export async function localWriteStream(absDir: string, filename: string) {
    await ensureDir(absDir);
    const full = path.join(absDir, filename);
    return { stream: fs.createWriteStream(full), fullPath: full };
}
export function localArtifactLoc(fullPath: string): LocalLoc {
    return { kind: "local", path: fullPath };
}

/* ---------------- S3 ---------------- */
function makeS3Client(secret: S3Secret) {
    const cfg: any = { region: secret.region ?? "us-east-1" };
    if (secret.endpoint) cfg.endpoint = secret.endpoint;
    if (secret.accessKeyId && secret.secretAccessKey) {
        cfg.credentials = {
            accessKeyId: secret.accessKeyId,
            secretAccessKey: secret.secretAccessKey,
            sessionToken: secret.sessionToken,
        };
    }
    if (secret.forcePathStyle != null) cfg.forcePathStyle = secret.forcePathStyle;
    return new S3Client(cfg);
}

export async function s3PutObject(
    secret: S3Secret,
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | NodeReadable
) {
    const s3 = makeS3Client(secret);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body as any }));
}
export async function s3Head(secret: S3Secret, bucket: string, key: string) {
    const s3 = makeS3Client(secret);
    return s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}
export async function s3Delete(secret: S3Secret, bucket: string, key: string) {
    const s3 = makeS3Client(secret);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
export async function s3PresignGet(
    secret: S3Secret,
    bucket: string,
    key: string,
    expiresSec = 60 * 10
) {
    const s3 = makeS3Client(secret);
    return getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: expiresSec }
    );
}

/* ---------------- SFTP (probe only) ---------------- */
export async function sftpProbe(opts: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    hostHash?: string;
    testPath: string;
}) {
    const client = new SftpClient();
    try {
        await client.connect({
            host: opts.host,
            port: opts.port ?? 22,
            username: opts.username,
            password: opts.password,
            privateKey: opts.privateKey,
            passphrase: opts.passphrase,
        });
        const dir = normalizeDirPath(opts.testPath).replace(/\/$/, "");
        const file = dir + "/remoteiq_probe_" + crypto.randomBytes(8).toString("hex") + ".txt";
        const data = Buffer.from("probe");
        await client.put(data, file);
        const read = (await client.get(file)) as Buffer;
        const okRead = read && read.length === data.length;
        await client.delete(file);
        return { write: true, read: okRead, delete: true };
    } finally {
        try { await client.end(); } catch { }
    }
}

/* ---------------- WebDAV (probe + upload + list + download) ---------------- */
export async function webdavProbe(opts: { url: string; username: string; password: string; path: string; }) {
    const client = createWebdavClient(opts.url, { username: opts.username, password: opts.password });
    const baseDir = normalizeDirPath(opts.path).replace(/\/$/, "");
    const name = "remoteiq_probe_" + crypto.randomBytes(8).toString("hex") + ".txt";
    const p = normalizeFilePath(`${baseDir}/${name}`);
    const data = "probe";
    await client.putFileContents(p, data, { overwrite: true });
    const read = await client.getFileContents(p, { format: "text" });
    const okRead = read === data;
    await client.deleteFile(p);
    return { write: true, read: okRead, delete: true };
}
export async function webdavUpload(opts: {
    url: string; username: string; password: string;
    directory: string; filename: string; body: Buffer | NodeReadable;
}) {
    const client = createWebdavClient(opts.url, { username: opts.username, password: opts.password });
    const base = normalizeDirPath(opts.directory).replace(/\/$/, "");
    const full = normalizeFilePath(`${base}/${opts.filename}`);
    await client.putFileContents(full, opts.body as any, { overwrite: true });
    return full;
}
export async function webdavDownloadAsBuffer(opts: {
    url: string; username: string; password: string; remotePath: string;
}): Promise<Buffer> {
    const client = createWebdavClient(opts.url, { username: opts.username, password: opts.password });
    const rp = normalizeFilePath(opts.remotePath);
    const buf = await client.getFileContents(rp, { format: "binary" }) as Buffer;
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as any);
}
export async function webdavListDirs(opts: {
    url: string; username: string; password: string; basePath: string;
}): Promise<string[]> {
    let baseUrl = String(opts.url || "").trim();
    if (!baseUrl) throw new Error("webdavListDirs: missing url");
    if (!baseUrl.endsWith("/")) baseUrl += "/";

    const client = createWebdavClient(baseUrl, { username: opts.username, password: opts.password });
    const cleaned = String(opts.basePath || "/").replace(/\/{2,}/g, "/");
    const rel = cleaned.replace(/^\/+/, "");
    const relDir = rel.endsWith("/") ? rel : rel + "/";
    const absPathname = new URL(relDir, baseUrl).pathname;

    const toAbs = (p: string) => {
        const s = String(p || "");
        const pathOnly = s.replace(/^https?:\/\/[^/]+/i, "");
        const withLead = pathOnly.startsWith("/") ? pathOnly : "/" + pathOnly;
        return withLead.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    };

    async function tryList(pathArg: string) {
        const items = await client.getDirectoryContents(pathArg, { deep: false }) as any[];
        return (items || []).filter((x) => x.type === "directory").map((x) => toAbs(String(x.filename ?? x.href ?? "")));
    }

    try {
        const dirs = await tryList(relDir);
        return Array.from(new Set(dirs)).sort((a, b) => a.localeCompare(b));
    } catch (e: any) {
        if (String(e?.message || "").includes("401") || String(e?.message || "").includes("404")) {
            const dirs = await tryList(absPathname);
            return Array.from(new Set(dirs)).sort((a, b) => a.localeCompare(b));
        }
        throw e;
    }
}

/* ---------------- Google Drive (probe + upload + download) ---------------- */

function makeDriveClient(credentialsJson: any) {
    if (!credentialsJson?.client_email || !credentialsJson?.private_key) {
        throw new Error("Missing Google service account JSON (client_email/private_key)");
    }
    const auth = new google.auth.JWT({
        email: credentialsJson.client_email,
        key: credentialsJson.private_key,
        scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    return google.drive({ version: "v3", auth });
}

/** Find or create a subfolder inside a parent folder and return its id. Works with personal + Shared Drives. */
async function ensureSubfolder(drive: any, parentId: string, name: string): Promise<string> {
    const q = [
        `'${parentId}' in parents`,
        `mimeType = 'application/vnd.google-apps.folder'`,
        `name = '${name.replace(/'/g, "\\'")}'`,
        "trashed = false",
    ].join(" and ");

    const { data } = await drive.files.list({
        q,
        fields: "files(id,name)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "allDrives",
    });

    if (data.files && data.files[0]) return data.files[0].id;

    const created = await drive.files.create({
        requestBody: {
            name,
            parents: [parentId],
            mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
        supportsAllDrives: true,
    });

    return created.data.id!;
}

export async function gdriveProbe(opts: { credentialsJson: any; folderId?: string }) {
    if (!opts.folderId) {
        throw new Error("Google Drive folderId is required");
    }
    const drive = makeDriveClient(opts.credentialsJson);
    const name = "remoteiq_probe_" + crypto.randomBytes(8).toString("hex") + ".txt";
    const createRes = await drive.files.create({
        requestBody: { name, parents: [opts.folderId] },
        media: { mimeType: "text/plain", body: "probe" as any },
        fields: "id",
        supportsAllDrives: true,
    });
    const id = createRes.data.id!;
    const get = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "arraybuffer" });
    const okRead = Buffer.from(get.data as any).toString("utf8") === "probe";
    await drive.files.delete({ fileId: id, supportsAllDrives: true });
    return { write: true, read: okRead, delete: true };
}

export async function gdriveUpload(opts: {
    credentialsJson: any;            // service account JSON
    folderId: string;                // parent folder ID (Shared Drive or My Drive folder)
    subfolder?: string;              // optional subfolder to create/use inside folderId
    name: string;                    // filename
    body: Buffer | NodeReadable;     // content
}): Promise<{ fileId: string }> {
    if (!opts.folderId) throw new Error("Google Drive folderId missing");
    const drive = makeDriveClient(opts.credentialsJson);

    let parentId = opts.folderId;
    if (opts.subfolder && opts.subfolder.trim()) {
        parentId = await ensureSubfolder(drive, parentId, opts.subfolder.trim());
    }

    const res = await drive.files.create({
        requestBody: { name: opts.name, parents: [parentId] },
        media: { mimeType: "application/gzip", body: opts.body as any },
        fields: "id",
        supportsAllDrives: true,
    });
    const fileId = res.data.id!;
    return { fileId };
}

export async function gdriveDownloadAsBuffer(opts: {
    credentialsJson: any;
    fileId: string;
}): Promise<Buffer> {
    const drive = makeDriveClient(opts.credentialsJson);
    const res = await drive.files.get({ fileId: opts.fileId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(res.data as any);
}
