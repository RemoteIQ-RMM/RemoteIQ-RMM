import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { PgPoolService } from "../storage/pg-pool.service";
import { OrganizationContextService } from "../storage/organization-context.service";
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
    status: "running" | "completed" | "failed" | "cancelled";
    note: string | null;
    size_bytes: number | null;
    duration_sec: number | null;
    verified: boolean | null;
};

type HistoryStatus = "success" | "failed" | "running";

function mapFilterStatus(status: HistoryStatus | undefined): string | undefined {
    if (!status) return undefined;
    if (status === "success") return "completed";
    return status;
}

function projectStatus(status: string): HistoryStatus {
    switch (status) {
        case "completed":
            return "success";
        case "failed":
        case "cancelled":
            return "failed";
        default:
            return "running";
    }
}

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

type PolicyRow = {
    id: string;
    schedule: string;
    retention: any;
    options: any;
    destination_id: string | null;
    destination_provider: string | null;
    destination_configuration: any | null;
};

type PolicyConfig = {
    policyId: string;
    enabled: boolean;
    targets: string[];
    schedule: string;
    cronExpr?: string;
    retentionDays: number;
    encrypt: boolean;
    destination: any | null;
    notifications: Record<string, any>;
    lastScheduledAt?: string | null;
};

@Injectable()
export class BackupsService {
    constructor(
        private readonly db: PgPoolService,
        private readonly notifier: NotifierService,
        private readonly worker: WorkerService,
        private readonly orgContext: OrganizationContextService,
    ) { }

    private async orgId(): Promise<string> {
        return this.orgContext.getDefaultOrganizationId();
    }

    private retentionDays(retention: any): number {
        if (!retention) return 30;
        if (typeof retention.days === "number") return retention.days;
        if (typeof retention.value === "number" && retention.unit === "days") {
            return retention.value;
        }
        return 30;
    }

    private parsePolicy(row: PolicyRow | null): PolicyConfig | null {
        if (!row) return null;
        const options = row.options && typeof row.options === "object" ? row.options : {};
        const destination =
            row.destination_configuration && typeof row.destination_configuration === "object"
                ? row.destination_configuration
                : null;

        const cronExpr = options.cronExpr ?? options.cron_expr ?? undefined;
        const notifications =
            options.notifications && typeof options.notifications === "object"
                ? options.notifications
                : {};

        const enabled = options.enabled ?? false;
        const rawTargets = Array.isArray(options.targets)
            ? options.targets.filter((t: any) => typeof t === "string" && t.trim().length)
            : [];
        const targets = rawTargets.length ? rawTargets : ["users", "roles", "devices", "settings"];
        const encrypt = options.encrypt ?? true;
        const lastScheduledAt = options.lastScheduledAt ?? options.last_scheduled_at ?? null;

        return {
            policyId: row.id,
            enabled,
            targets,
            schedule: row.schedule,
            cronExpr: cronExpr ?? undefined,
            retentionDays: this.retentionDays(row.retention),
            encrypt,
            destination,
            notifications,
            lastScheduledAt,
        };
    }

    private normalizeDestinationInput(dest: any): { provider: string; configuration: any } {
        if (!dest || typeof dest !== "object") {
            throw new BadRequestException("Destination required");
        }
        const provider = dest.kind === "remote" ? "sftp" : dest.kind;
        return {
            provider,
            configuration: { ...dest },
        };
    }

    private async fetchDefaultPolicyRow(): Promise<PolicyRow | null> {
        const orgId = await this.orgId();
        const { rows } = await this.db.query<PolicyRow>(
            `SELECT p.id,
                    p.schedule,
                    p.retention,
                    p.options,
                    p.destination_id,
                    d.provider AS destination_provider,
                    d.configuration AS destination_configuration
               FROM backup_policies p
          LEFT JOIN backup_destinations d ON d.id = p.destination_id
              WHERE p.organization_id = $1
           ORDER BY p.is_default DESC, p.created_at ASC
              LIMIT 1`,
            [orgId]
        );
        return rows[0] ?? null;
    }

    private async fetchDefaultPolicy(): Promise<PolicyConfig | null> {
        const row = await this.fetchDefaultPolicyRow();
        return this.parsePolicy(row);
    }

    private async upsertDestination(
        orgId: string,
        dest: any,
    ): Promise<{ id: string; provider: string; configuration: any }> {
        const { provider, configuration } = this.normalizeDestinationInput(dest);
        const { rows } = await this.db.query<{ id: string; provider: string; configuration: any }>(
            `INSERT INTO backup_destinations (organization_id, name, provider, configuration)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (organization_id, name)
             DO UPDATE SET provider = EXCLUDED.provider,
                           configuration = EXCLUDED.configuration,
                           updated_at = NOW()
             RETURNING id, provider, configuration`,
            [orgId, "Default Backup Destination", provider, JSON.stringify(configuration)]
        );
        return rows[0];
    }

    private async upsertPolicy(
        orgId: string,
        destinationId: string,
        cfg: BackupConfigDto,
        existingOptions: Record<string, any>,
    ): Promise<PolicyConfig | null> {
        const mergedOptions = {
            ...existingOptions,
            enabled: !!cfg.enabled,
            targets: cfg.targets,
            cronExpr: cfg.schedule === "cron" ? cfg.cronExpr ?? null : null,
            cron_expr: cfg.schedule === "cron" ? cfg.cronExpr ?? null : null,
            encrypt: !!cfg.encrypt,
            notifications: cfg.notifications ?? {},
        };
        if (mergedOptions.cronExpr == null) delete (mergedOptions as any).cronExpr;
        if (mergedOptions.cron_expr == null) delete (mergedOptions as any).cron_expr;
        const inserted = await this.db.query<{ id: string }>(
            `INSERT INTO backup_policies (
                 organization_id,
                 name,
                 description,
                 schedule,
                 retention,
                 destination_id,
                 target_type,
                 target_id,
                 options,
                 is_default)
             VALUES (
                 $1,
                 $2,
                 $3,
                 $4,
                 $5::jsonb,
                 $6,
                 'organization',
                 NULL,
                 $7::jsonb,
                 TRUE)
             ON CONFLICT (organization_id, name)
             DO UPDATE SET
                 description = EXCLUDED.description,
                 schedule = EXCLUDED.schedule,
                 retention = EXCLUDED.retention,
                 destination_id = EXCLUDED.destination_id,
                 target_type = EXCLUDED.target_type,
                 target_id = EXCLUDED.target_id,
                 options = EXCLUDED.options,
                 is_default = TRUE,
                 updated_at = NOW()
             RETURNING id`,
            [
                orgId,
                "Default Backup Policy",
                "Normalized default backups policy",
                cfg.schedule,
                JSON.stringify({ days: cfg.retentionDays }),
                destinationId,
                JSON.stringify(mergedOptions),
            ]
        );
        const policyId = inserted.rows[0]?.id;
        if (!policyId) {
            return null;
        }

        const detail = await this.db.query<PolicyRow>(
            `SELECT p.id,
                    p.schedule,
                    p.retention,
                    p.options,
                    p.destination_id,
                    d.provider AS destination_provider,
                    d.configuration AS destination_configuration
               FROM backup_policies p
          LEFT JOIN backup_destinations d ON d.id = p.destination_id
              WHERE p.id = $1`,
            [policyId]
        );
        return this.parsePolicy(detail.rows[0] ?? null);
    }

    private async ensurePolicyAndDestination(cfg?: BackupConfigDto): Promise<PolicyConfig | null> {
        if (!cfg) {
            return this.fetchDefaultPolicy();
        }
        const orgId = await this.orgId();
        const currentRow = await this.fetchDefaultPolicyRow();
        const existingOptions =
            currentRow && currentRow.options && typeof currentRow.options === "object"
                ? currentRow.options
                : {};

        const destination = await this.upsertDestination(orgId, cfg.destination);
        return this.upsertPolicy(orgId, destination.id, cfg, existingOptions);
    }

    /* ---------------- Permissions (UI helper) --------------- */
    async getPermissions() {
        // Controller derives real booleans via RBAC; keep this as a safe default fallback.
        return { restore: true, download: true };
    }

    /* ---------------- Config --------------------- */
    async getConfig() {
        const policy = await this.fetchDefaultPolicy();
        if (!policy) {
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

        return {
            enabled: policy.enabled,
            targets: policy.targets,
            schedule: policy.schedule as any,
            cronExpr: policy.cronExpr,
            retentionDays: policy.retentionDays,
            encrypt: policy.encrypt,
            destination: policy.destination ?? { kind: "local", path: "/var/remoteiq/backups" },
            notifications: policy.notifications,
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
        const policy = await this.ensurePolicyAndDestination(cfg);
        return {
            ok: true,
            policyId: policy?.policyId,
        };
    }

    /* ---------------- History -------------------- */
    async listHistory(q: HistoryQueryDto) {
        const pageSize = 50;
        const page = parseCursor(q.cursor);
        const offset = page * pageSize;

        const params: any[] = [];
        const where: string[] = [];

        const policy = await this.fetchDefaultPolicy();
        if (policy?.policyId) {
            params.push(policy.policyId);
            where.push(`(policy_id = $${params.length} OR policy_id IS NULL)`);
        }
        const statusFilter = mapFilterStatus(q.status as HistoryStatus | undefined);
        if (statusFilter) {
            params.push(statusFilter);
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

        const { rows } = await this.db.query<JobRow>(sql, params);
        const items = rows.slice(0, pageSize).map((r) => ({
            id: r.id,
            at: r.started_at.toISOString().slice(0, 16).replace("T", " "),
            status: projectStatus(r.status),
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
        const policy = await this.fetchDefaultPolicyRow();
        if (!policy) return { updated: false };

        const { rows } = await this.db.query(
            `UPDATE backup_policies
                SET options = jsonb_set(
                    COALESCE(options, '{}'::jsonb),
                    '{lastScheduledAt}',
                    to_jsonb(($2)::timestamptz),
                    true
                )
             WHERE id = $1
               AND (
                    options->>'lastScheduledAt' IS NULL
                 OR (options->>'lastScheduledAt')::timestamptz < ($2)::timestamptz - interval '30 seconds'
               )
             RETURNING 1`,
            [policy.id, now.toISOString()]
        );
        return { updated: rows.length > 0 };
    }

    async kickWorker() {
        await this.worker.runOneIfAny();
    }

    /* ---------------- Actions -------------------- */
    async startBackupNow() {
        const policy = await this.ensurePolicyAndDestination();
        if (!policy) {
            throw new BadRequestException("Backups not configured");
        }
        if (!policy.enabled) {
            throw new BadRequestException("Backups disabled");
        }

        const id = crypto.randomUUID();
        await this.db.query(
            `INSERT INTO backup_jobs (id, policy_id, started_at, status, note)
             VALUES ($1, $2, NOW(), 'running', 'Manual run')`,
            [id, policy.policyId]
        );
        // Start immediately
        await this.worker.runOneIfAny();
        return { id, startedAt: new Date().toISOString() };
    }

    async pruneOld() {
        const policy = await this.fetchDefaultPolicy();
        if (!policy) {
            return { removed: 0 };
        }

        const params: any[] = [String(policy.retentionDays)];
        let sql = `DELETE FROM backup_jobs
             WHERE COALESCE(finished_at, started_at) < (NOW() - ($1 || ' days')::interval)
               AND status IN ('completed','failed','cancelled')`;

        if (policy.policyId) {
            params.push(policy.policyId);
            sql += ` AND (policy_id = $2 OR policy_id IS NULL)`;
        }

        const { rows } = await this.db.query(sql + ` RETURNING 1`, params);
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
        if (rows[0].status !== "completed")
            throw new BadRequestException("Backup not successful");

        await this.db.query(
            `INSERT INTO backup_restores (id, backup_job_id, status)
       VALUES ($1, $2, 'running')`,
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
            `SELECT j.status,
                    j.artifact_location,
                    d.configuration AS destination_configuration
               FROM backup_jobs j
          LEFT JOIN backup_policies p ON j.policy_id = p.id
          LEFT JOIN backup_destinations d ON d.id = p.destination_id
              WHERE j.id=$1`,
            [id]
        );
        if (!rows.length) return null;
        if (rows[0].status !== "completed")
            throw new BadRequestException("Backup not successful");

        const loc = rows[0].artifact_location || {};
        if (loc.kind === "local") {
            const fs = await import("fs");
            if (!fs.existsSync(loc.path)) return null;
            const filename = String(loc.path).split(/[\\/]/).pop() || "backup.tar.gz";
            return { filename, stream: fs.createReadStream(loc.path) };
        }
        if (loc.kind === "s3") {
            const destConfig = rows[0].destination_configuration || {};
            const connectionId = loc.connectionId || destConfig.connectionId;
            if (!connectionId) throw new BadRequestException("S3 connection missing");
            const row = (await this.db.query(
                `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='s3'`,
                [connectionId]
            )).rows[0];
            if (!row) throw new BadRequestException("S3 connection missing");
            const s3Cfg = { ...(row.config || {}), ...(row.secrets || {}) };
            const bucket = loc.bucket || destConfig.bucket || s3Cfg.bucket;
            const key = loc.key || destConfig.key;
            if (!bucket || !key) throw new BadRequestException("S3 location incomplete");
            const url = await s3PresignGet(s3Cfg, bucket, key, 60 * 10);
            const filename = String(key || "").split("/").pop() || "backup.tar.gz";
            return { presignedUrl: url, filename };
        }
        return null;
    }
}
