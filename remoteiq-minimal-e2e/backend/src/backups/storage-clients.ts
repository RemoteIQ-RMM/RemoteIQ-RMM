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
    kmsKeyId?: string; // (not used here, but reserved)
};

export async function ensureDir(p: string) {
    await fsp.mkdir(p, { recursive: true });
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

// ✅ Body type: Buffer | Uint8Array | Node Readable
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
        const file =
            opts.testPath.replace(/\/+$/, "") +
            "/remoteiq_probe_" +
            crypto.randomBytes(8).toString("hex") +
            ".txt";
        const data = Buffer.from("probe");
        await client.put(data, file);
        const read = (await client.get(file)) as Buffer;
        const okRead = read && read.length === data.length;
        await client.delete(file);
        return { write: true, read: okRead, delete: true };
    } finally {
        try {
            await client.end();
        } catch { }
    }
}

/* ---------------- WebDAV (probe only) ---------------- */
export async function webdavProbe(opts: {
    url: string;
    username: string;
    password: string;
    path: string;
}) {
    const client = createWebdavClient(opts.url, {
        username: opts.username,
        password: opts.password,
    });
    const base = opts.path.replace(/\/+$/, "");
    const name = "remoteiq_probe_" + crypto.randomBytes(8).toString("hex") + ".txt";
    const p = base + "/" + name;
    const data = "probe";
    await client.putFileContents(p, data, { overwrite: true });
    const read = await client.getFileContents(p, { format: "text" });
    const okRead = read === data;
    await client.deleteFile(p);
    return { write: true, read: okRead, delete: true };
}

/* ---------------- Google Drive (probe only) ---------------- */
export async function gdriveProbe(opts: { credentialsJson: any; folderId?: string }) {
    // ✅ Modern constructor signature with options object
    const auth = new google.auth.JWT({
        email: opts.credentialsJson.client_email,
        key: opts.credentialsJson.private_key,
        scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    const drive = google.drive({ version: "v3", auth });
    const name = "remoteiq_probe_" + crypto.randomBytes(8).toString("hex") + ".txt";

    const createRes = await drive.files.create({
        requestBody: { name, parents: opts.folderId ? [opts.folderId] : undefined },
        media: { mimeType: "text/plain", body: "probe" as any },
        fields: "id",
    });
    const id = createRes.data.id!;
    const get = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "arraybuffer" });
    const okRead = Buffer.from(get.data as any).toString("utf8") === "probe";
    await drive.files.delete({ fileId: id });
    return { write: true, read: okRead, delete: true };
}
