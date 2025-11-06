import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { BackupConfigDto, HistoryQueryDto } from "./dto";
import { Readable } from "stream";
import * as crypto from "crypto";
import { WorkerService } from "./worker.service";
import { NotifierService } from "./notifier.service";
import { s3PresignGet } from "./storage-clients";

type JobRow = {
    id: string;
    started_at: Date;
    finished_at: Date | null;
    status: "running" | "success" | "failed" | "cancelled";
    note: string | null;
    size_bytes: number | null;
    duration_sec: number | null;
    verified: boolean | null;
};

function isAbsolutePath(p: string) {
    return p.startsWith("/") || /^[A-Za-z]:\\/.test(p);
}
function sanitizeLocalPath(p: string) {
    if (!isAbsolutePath(p)) throw new BadRequestException("Path must be absolute");
    if (p.includes("..") || p.includes("\0")) throw new BadRequestException("Invalid path");
    return p;
}
function parseCursor(cur?: string | null): number {
    if (!cur) return 0;
    try {
        const { page } = JSON.parse(Buffer.from(cur, "base64").toString("utf8"));
        return Number(page) || 0;
    } catch {
        return 0;
    }
}
function makeCursor(page: number) {
    return Buffer.from(JSON.stringify({ page }), "utf8").toString("base64");
}

@Injectable()
export class BackupsService {
    constructor(
        private readonly db: PgPoolService,
        private readonly notifier: NotifierService,
        private readonly worker: WorkerService
    ) { }

    /* ---------------- Permissions (UI helper) --------------- */
    async getPermissions() {
        // Controller derives real booleans via RBAC; keep this as a safe default fallback.
        return { restore: true, download: true };
    }

    /* ---------------- Config --------------------- */
    async getConfig() {
        const { rows } = await this.db.query(
            `SELECT enabled, targets, schedule, cron_expr, retention_days, encrypt, destination, notifications
       FROM backups_config
       LIMIT 1`
        );
        if (!rows.length) {
            return {
                enabled: false,
                targets: ["users", "roles", "devices", "settings"],
                schedule: "daily",
                cronExpr: "0 3 * * *",
                retentionDays: 30,
                encrypt: true,
                destination: { kind: "local", path: "/var/remoteiq/backups" },
                notifications: { email: false, webhook: false, slack: false },
            };
        }
        const r = rows[0];
        return {
            enabled: !!r.enabled,
            targets: r.targets,
            schedule: r.schedule,
            cronExpr: r.cron_expr ?? undefined,
            retentionDays: Number(r.retention_days),
            encrypt: !!r.encrypt,
            destination: r.destination,
            notifications: r.notifications ?? undefined,
        };
    }

    validateDestination(dest: any) {
        if (!dest || typeof dest !== "object" || !dest.kind) {
            throw new BadRequestException("Destination required");
        }
        switch (dest.kind) {
            case "local":
                sanitizeLocalPath(String(dest.path || ""));
                break;
            case "s3":
            case "nextcloud":
            case "gdrive":
            case "remote":
                if (!dest.connectionId || !/^[0-9a-f-]{36}$/i.test(dest.connectionId)) {
                    throw new BadRequestException("Valid connectionId required");
                }
                if (dest.kind === "nextcloud") {
                    const p = String(dest.path || "");
                    if (!p.startsWith("/"))
                        throw new BadRequestException("Nextcloud path must start with '/'");
                }
                if (dest.kind === "remote") {
                    const p = String(dest.path || "");
                    if (!isAbsolutePath(p))
                        throw new BadRequestException("Remote path must be absolute");
                }
                break;
            default:
                throw new BadRequestException("Unsupported destination");
        }
    }

    async saveConfig(cfg: BackupConfigDto) {
        if (cfg.schedule === "cron" && !cfg.cronExpr) {
            throw new BadRequestException("cronExpr required for schedule=cron");
        }
        const sql = `
      INSERT INTO backups_config (id, enabled, targets, schedule, cron_expr, retention_days, encrypt, destination, notifications)
      VALUES ('singleton', $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        enabled=$1, targets=$2, schedule=$3, cron_expr=$4, retention_days=$5, encrypt=$6, destination=$7::jsonb, notifications=$8::jsonb
    `;
        await this.db.query(sql, [
            !!cfg.enabled,
            JSON.stringify(cfg.targets),
            cfg.schedule,
            cfg.cronExpr ?? null,
            cfg.retentionDays,
            !!cfg.encrypt,
            JSON.stringify(cfg.destination),
            JSON.stringify(cfg.notifications || {}),
        ]);
        return { ok: true };
    }

    /* ---------------- History -------------------- */
    async listHistory(q: HistoryQueryDto) {
        const pageSize = 50;
        const page = parseCursor(q.cursor);
        const offset = page * pageSize;

        const params: any[] = [];
        const where: string[] = [];
        if (q.status) {
            params.push(q.status);
            where.push(`status = $${params.length}`);
        }
        if (q.q?.trim()) {
            params.push(`%${q.q.trim()}%`);
            where.push(`(id::text ILIKE $${params.length} OR note ILIKE $${params.length})`);
        }
        if (q.from) {
            params.push(q.from);
            where.push(`started_at >= $${params.length}::date`);
        }
        if (q.to) {
            params.push(q.to);
            where.push(`started_at < ($${params.length}::date + INTERVAL '1 day')`);
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const sql = `
      SELECT id, started_at, status, note, size_bytes, duration_sec, verified
      FROM backup_jobs
      ${whereSql}
      ORDER BY started_at DESC
      LIMIT ${pageSize + 1}
      OFFSET ${offset}
    `;

        const { rows } = await this.db.query(sql, params);
        const items = rows.slice(0, pageSize).map((r: JobRow) => ({
            id: r.id,
            at: r.started_at.toISOString().slice(0, 16).replace("T", " "),
            status: r.status,
            note: r.note ?? undefined,
            sizeBytes: r.size_bytes ?? undefined,
            durationSec: r.duration_sec ?? undefined,
            verified: r.verified ?? undefined,
        }));

        const hasMore = rows.length > pageSize;
        return { items, nextCursor: hasMore ? makeCursor(page + 1) : undefined };
    }

    /* ---------------- Scheduler hooks ------------- */
    async markScheduledOnce(now: Date) {
        // prevent double fire across restarts within a 30s window
        const { rows } = await this.db.query(
            `UPDATE backups_config
         SET last_scheduled_at=$1
       WHERE (last_scheduled_at IS NULL OR last_scheduled_at < $1 - interval '30 seconds')
       RETURNING 1`,
            [now.toISOString()]
        );
        return { updated: rows.length > 0 };
    }

    async kickWorker() {
        await this.worker.runOneIfAny();
    }

    /* ---------------- Actions -------------------- */
    async startBackupNow() {
        const id = crypto.randomUUID();
        await this.db.query(
            `INSERT INTO backup_jobs (id, started_at, status, note)
       VALUES ($1, NOW(), 'running', 'Scheduled run')`,
            [id]
        );
        // Start immediately
        await this.worker.runOneIfAny();
        return { id, startedAt: new Date().toISOString() };
    }

    async pruneOld() {
        const cfg = await this.getConfig();
        const { rows } = await this.db.query(
            `DELETE FROM backup_jobs
       WHERE COALESCE(finished_at, started_at) < (NOW() - ($1 || ' days')::interval)
         AND status IN ('success','failed','cancelled')
       RETURNING 1`,
            [String(cfg.retentionDays)]
        );
        return { removed: rows.length };
    }

    // Real destination testing (local & S3), probes for others via helper module.
    async testDestination(dest: any) {
        if (dest.kind === "local") {
            sanitizeLocalPath(dest.path);
            const { ensureDir } = await import("./storage-clients");
            const fs = await import("fs/promises");
            const p = require("path").join(dest.path, ".remoteiq_probe.txt");
            await ensureDir(dest.path);
            await fs.writeFile(p, "probe");
            const r = await fs.readFile(p, "utf8");
            await fs.unlink(p);
            return { ok: r === "probe", phases: { write: true, read: r === "probe", delete: true } };
        }

        if (dest.kind === "s3") {
            const cid = dest.connectionId;
            const row = (await this.db.query(
                `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='s3'`,
                [cid]
            )).rows[0];
            if (!row) throw new BadRequestException("S3 connection not found");
            const cfgS3 = { ...(row.config || {}), ...(row.secrets || {}) };
            const bucket = dest.bucket || cfgS3.bucket;
            const prefix = (dest.prefix || cfgS3.prefix || "").replace(/^\/+|\/+$/g, "");
            const key = (prefix ? `${prefix}/` : "") + ".remoteiq_probe.txt";
            const { s3PutObject, s3Head, s3Delete } = await import("./storage-clients");
            await s3PutObject(cfgS3, bucket, key, Buffer.from("probe"));
            const head = await s3Head(cfgS3, bucket, key);
            const ok = !!head;
            await s3Delete(cfgS3, bucket, key);
            return { ok, phases: { write: true, read: ok, delete: true } };
        }

        if (dest.kind === "nextcloud") {
            const cid = dest.connectionId;
            const row = (await this.db.query(
                `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='nextcloud'`,
                [cid]
            )).rows[0];
            if (!row) throw new BadRequestException("Nextcloud connection not found");
            const { webdavProbe } = await import("./storage-clients");
            const url = row.config?.url;
            const username = row.secrets?.username;
            const password = row.secrets?.password;
            const path = dest.path;
            const phases = await webdavProbe({ url, username, password, path });
            return { ok: phases.write && phases.read && phases.delete, phases };
        }

        if (dest.kind === "remote") {
            const cid = dest.connectionId;
            const row = (await this.db.query(
                `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='sftp'`,
                [cid]
            )).rows[0];
            if (!row) throw new BadRequestException("SFTP connection not found");
            const { sftpProbe } = await import("./storage-clients");
            const host = row.config?.host;
            const port = row.config?.port;
            const username = row.secrets?.username;
            const password = row.secrets?.password;
            const privateKey = row.secrets?.privateKey;
            const passphrase = row.secrets?.passphrase;
            const phases = await sftpProbe({
                host,
                port,
                username,
                password,
                privateKey,
                passphrase,
                testPath: dest.path,
            });
            return { ok: phases.write && phases.read && phases.delete, phases };
        }

        if (dest.kind === "gdrive") {
            const cid = dest.connectionId;
            const row = (await this.db.query(
                `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='gdrive'`,
                [cid]
            )).rows[0];
            if (!row) throw new BadRequestException("GDrive connection not found");
            const { gdriveProbe } = await import("./storage-clients");
            const credentialsJson = row.secrets?.serviceAccountJson;
            const folderId = row.config?.folderId || undefined;
            const phases = await gdriveProbe({ credentialsJson, folderId });
            return { ok: phases.write && phases.read && phases.delete, phases };
        }

        throw new BadRequestException("Unsupported destination");
    }

    async testNotification() {
        await this.notifier.send(
            { email: true, slack: true, webhook: true },
            "RemoteIQ Backups: Test",
            "This is a test notification."
        );
        return { sent: true };
    }

    async retryJob(id: string) {
        const { rows } = await this.db.query(
            `UPDATE backup_jobs
         SET status='running', note='Retry queued', finished_at=NULL, cancelled=false
       WHERE id=$1 AND status='failed'
       RETURNING 1`,
            [id]
        );
        if (!rows.length) throw new BadRequestException("Job not in failed state");
        await this.worker.runOneIfAny();
        return { queued: true };
    }

    async cancelJob(id: string) {
        const { rows } = await this.db.query(
            `UPDATE backup_jobs
         SET cancelled=true, status='cancelled', finished_at=NOW(), note='Cancelled by user'
       WHERE id=$1 AND status='running'
       RETURNING 1`,
            [id]
        );
        if (!rows.length) throw new BadRequestException("Job not running");
        return { sent: true };
    }

    async startRestore(id: string) {
        const { rows } = await this.db.query(
            `SELECT id, status FROM backup_jobs WHERE id=$1 LIMIT 1`,
            [id]
        );
        if (!rows.length) throw new NotFoundException("Backup not found");
        if (rows[0].status !== "success")
            throw new BadRequestException("Backup not successful");

        await this.db.query(
            `INSERT INTO backup_restores (id, backup_id, requested_at, status)
       VALUES ($1, $2, NOW(), 'running')`,
            [crypto.randomUUID(), id]
        );
        return { started: true };
    }

    /* ---------------- Artifacts ------------------- */
    async openLogStream(id: string): Promise<Readable | null> {
        const { rows } = await this.db.query(
            `SELECT log_text FROM backup_job_logs WHERE job_id=$1`,
            [id]
        );
        if (!rows.length) return null;
        const text: string = rows[0].log_text ?? "";
        return Readable.from(text);
    }

    async getManifest(id: string): Promise<any | null> {
        const { rows } = await this.db.query(
            `SELECT manifest FROM backup_job_manifests WHERE job_id=$1`,
            [id]
        );
        if (!rows.length) return null;
        return rows[0].manifest;
    }

    async getDownload(id: string): Promise<{ presignedUrl?: string; stream?: Readable; filename: string } | null> {
        const { rows } = await this.db.query(
            `SELECT status, artifact_location FROM backup_jobs WHERE id=$1`,
            [id]
        );
        if (!rows.length) return null;
        if (rows[0].status !== "success")
            throw new BadRequestException("Backup not successful");

        const loc = rows[0].artifact_location || {};
        if (loc.kind === "local") {
            const fs = await import("fs");
            if (!fs.existsSync(loc.path)) return null;
            const filename = String(loc.path).split(/[\\/]/).pop() || "backup.tar.gz";
            return { filename, stream: fs.createReadStream(loc.path) };
        }
        if (loc.kind === "s3") {
            // Reuse the configured S3 connection for presigning
            const cfg = await this.getConfig();
            if (cfg.destination.kind !== "s3")
                throw new BadRequestException("S3 destination not active");
            const row = (await this.db.query(
                `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='s3'`,
                [cfg.destination.connectionId]
            )).rows[0];
            if (!row) throw new BadRequestException("S3 connection missing");
            const s3Cfg = { ...(row.config || {}), ...(row.secrets || {}) };
            const url = await s3PresignGet(s3Cfg, loc.bucket, loc.key, 60 * 10);
            const filename = String(loc.key || "").split("/").pop() || "backup.tar.gz";
            return { presignedUrl: url, filename };
        }
        return null;
    }
}
