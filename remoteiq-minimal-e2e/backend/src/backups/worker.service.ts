import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import archiver from "archiver";
import { PgPoolService } from "../storage/pg-pool.service";
import { s3PutObject, s3Head, ensureDir, webdavUpload, gdriveUpload } from "./storage-clients";
import { NotifierService } from "./notifier.service";

type Job = { id: string; status: string; cancelled: boolean };

type FanoutDest =
    | { kind: "local"; path: string; priority?: number }
    | { kind: "s3"; connectionId: string; bucket?: string; prefix?: string; priority?: number }
    | { kind: "nextcloud"; connectionId: string; path: string; priority?: number }
    | { kind: "gdrive"; connectionId: string; subfolder?: string; priority?: number }
    | { kind: "remote"; connectionId: string; path: string; priority?: number };

type JobConfig = {
    targets: string[];
    destination:
    | { kind: "local"; path: string }
    | { kind: "s3"; connectionId: string; bucket?: string; prefix?: string }
    | { kind: "nextcloud"; connectionId: string; path: string }
    | { kind: "gdrive"; connectionId: string; subfolder?: string }
    | { kind: "remote"; connectionId: string; path: string };
    extras: FanoutDest[]; // additional destinations (fan-out)
    notifications: { email?: boolean; slack?: boolean; webhook?: boolean };
    /** Runner hints (from policy.options) */
    minSuccess?: number;
    parallelism?: number;
};

@Injectable()
export class WorkerService {
    private log = new Logger("BackupsWorker");
    private running = false;

    constructor(
        private readonly db: PgPoolService,
        private readonly notifier: NotifierService
    ) { }

    /** Picks the oldest running job and processes it (re-entrant safe). */
    async runOneIfAny() {
        if (this.running) return;
        const job = await this.pickJob();
        if (!job) return;

        this.running = true;
        try {
            await this.process(job.id);
        } finally {
            this.running = false;
        }
    }

    private async pickJob(): Promise<Job | null> {
        const { rows } = await this.db.query(
            `SELECT id, status, cancelled
         FROM backup_jobs
        WHERE status='running' AND cancelled=false
        ORDER BY started_at ASC
        LIMIT 1`
        );
        return rows[0] ?? null;
    }

    private async appendLog(jobId: string, chunk: string) {
        await this.db.query(
            `INSERT INTO backup_job_logs (job_id, log_text)
       VALUES ($1, $2)
       ON CONFLICT (job_id) DO UPDATE SET log_text = backup_job_logs.log_text || $2`,
            [jobId, chunk]
        );
    }

    /** simple bounded-concurrency helper */
    private async pLimit<T>(limit: number, tasks: (() => Promise<T>)[]) {
        const results: Promise<T>[] = [];
        const pool: Promise<void>[] = [];
        let i = 0;
        const run = async () => {
            while (i < tasks.length) {
                const idx = i++;
                results[idx] = tasks[idx]();
                await results[idx].then(() => void 0, () => void 0);
            }
        };
        for (let k = 0; k < Math.max(1, limit); k++) pool.push(run());
        await Promise.all(pool);
        return Promise.allSettled(results);
    }

    /**
     * Process a single job:
     *  - export selected targets to NDJSON (skip missing)
     *  - tar.gz into an archive
     *  - write to local path or upload to remote destination(s)
     *  - fan-out to extra destinations
     *  - persist manifest/log
     *  - mark success (respecting minSuccess)
     */
    async process(jobId: string) {
        const started = Date.now();

        const cfg = await this.loadJobConfig(jobId);
        if (!cfg) {
            await this.fail(jobId, "Backup configuration missing");
            return;
        }

        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "remoteiq-bkp-"));
        const exportDir = path.join(tmpRoot, "export");
        await ensureDir(exportDir);

        try {
            // Export targets -> NDJSON files
            const targets: string[] = cfg.targets.length ? cfg.targets : ["users", "devices", "settings"];

            const manifest: any = {
                id: jobId,
                targets,
                files: [],
                counts: {},
                createdAt: new Date().toISOString(),
            };

            await this.appendLog(jobId, `Exporting targets: ${targets.join(", ")}\n`);

            for (const t of targets) {
                const table = await this.resolveExistingTableForTarget(jobId, t);
                if (!table) {
                    await this.appendLog(jobId, `  - ${t}: skipped (no mapped table/view exists)\n`);
                    manifest.counts[t] = 0;
                    continue;
                }

                const file = path.join(exportDir, `${t}.ndjson`);
                const ws = fs.createWriteStream(file, { flags: "w" });

                try {
                    const { rows } = await this.db.query(`SELECT * FROM ${table}`);
                    let count = 0;
                    for (const row of rows) {
                        ws.write(JSON.stringify(row) + "\n");
                        count++;
                    }
                    await new Promise((r) => ws.end(r));
                    manifest.files.push(path.basename(file));
                    manifest.counts[t] = count;
                    await this.appendLog(jobId, `  - ${t}: ${count} rows (from ${table})\n`);
                } catch (e: any) {
                    await new Promise((r) => ws.end(r));
                    await this.appendLog(jobId, `  - ${t}: error reading ${table} → ${e?.message || e}; skipped\n`);
                    manifest.counts[t] = 0;
                }
            }

            // Create archive (.tar.gz)
            const archiveName = `backup_${new Date()
                .toISOString()
                .replace(/[:]/g, "-")
                .replace(/\..+/, "")}.tar.gz`;
            const archivePath = path.join(tmpRoot, archiveName);
            await this.createTarGz(exportDir, archivePath);

            const stat = await fsp.stat(archivePath);
            await this.appendLog(jobId, `Archive created: ${archiveName} (${stat.size} bytes)\n`);

            // Upload primary destination
            const dest = cfg.destination as any;
            let artifactLoc: any = null;
            let successCount = 0;

            if (dest.kind === "local") {
                const full = path.join(dest.path, path.basename(archivePath));
                await ensureDir(dest.path);
                await fsp.copyFile(archivePath, full);
                artifactLoc = { kind: "local", path: full };
                await this.appendLog(jobId, `Saved to local path: ${full}\n`);
                successCount += 1;
            } else if (dest.kind === "s3") {
                const cid = dest.connectionId;
                const conn = (
                    await this.db.query(
                        `SELECT config, secrets
               FROM storage_connections
              WHERE id=$1 AND kind='s3'`,
                        [cid]
                    )
                ).rows[0];
                if (!conn) throw new Error("S3 connection not found");
                const cfgS3 = { ...(conn.config || {}), ...(conn.secrets || {}) };
                const bucket = dest.bucket || cfgS3.bucket;
                if (!bucket) throw new Error("S3 bucket not specified");
                const prefix = (dest.prefix || cfgS3.prefix || "").replace(/^\/+|\/+$/g, "");
                const key = (prefix ? `${prefix}/` : "") + path.basename(archivePath);
                await s3PutObject(cfgS3, bucket, key, fs.createReadStream(archivePath));
                await s3Head(cfgS3, bucket, key);
                artifactLoc = {
                    kind: "s3",
                    bucket,
                    key,
                    connectionId: cid,
                    region: cfgS3.region,
                    endpoint: cfgS3.endpoint,
                };
                await this.appendLog(jobId, `Uploaded to s3://${bucket}/${key}\n`);
                successCount += 1;
            } else if (dest.kind === "nextcloud") {
                const cid = dest.connectionId;
                const conn = (
                    await this.db.query(
                        `SELECT config, secrets
               FROM storage_connections
              WHERE id=$1 AND kind='nextcloud'`,
                        [cid]
                    )
                ).rows[0];
                if (!conn) throw new Error("Nextcloud connection not found");
                const webdavUrl = conn.config?.webdavUrl;
                const username = conn.config?.username;
                const password = conn.secrets?.password;
                const directory = String(dest.path || conn.config?.path || "/").trim();
                if (!webdavUrl || !username || !password) {
                    throw new Error("Nextcloud connection incomplete (need webdavUrl, username, password)");
                }
                const remotePath = await webdavUpload({
                    url: webdavUrl,
                    username,
                    password,
                    directory,
                    filename: path.basename(archivePath),
                    body: fs.createReadStream(archivePath),
                });
                artifactLoc = { kind: "nextcloud", connectionId: cid, path: remotePath };
                await this.appendLog(jobId, `Uploaded to Nextcloud ${remotePath}\n`);
                successCount += 1;
            } else if (dest.kind === "gdrive") {
                const cid = dest.connectionId;
                const conn = (
                    await this.db.query(
                        `SELECT config, secrets
               FROM storage_connections
              WHERE id=$1 AND kind='gdrive'`,
                        [cid]
                    )
                ).rows[0];
                if (!conn) throw new Error("GDrive connection not found");

                const credentialsJson = conn.secrets?.serviceAccountJson;
                const folderId: string | undefined = conn.config?.folderId;
                if (!credentialsJson || !folderId) {
                    throw new Error("GDrive connection incomplete (missing service account JSON or folderId)");
                }

                const { fileId } = await gdriveUpload({
                    credentialsJson,
                    folderId,
                    subfolder: dest.subfolder || undefined,
                    name: path.basename(archivePath),
                    body: fs.createReadStream(archivePath),
                });

                artifactLoc = {
                    kind: "gdrive",
                    connectionId: cid,
                    fileId,
                    name: path.basename(archivePath),
                };
                await this.appendLog(jobId, `Uploaded to Google Drive fileId=${fileId}\n`);
                successCount += 1;
            } else {
                // Primary kinds not supported (guarded by service), but double-check here
                throw new Error(`Destination kind '${dest.kind}' not supported for primary upload`);
            }

            // ---- Fan-out to extra destinations (replication) ----
            const replicaOk = await this.replicateExtras(
                jobId,
                cfg.extras || [],
                archivePath,
                path.basename(archivePath),
                cfg.parallelism ?? 2
            );
            successCount += replicaOk;

            // Enforce minSuccess if provided
            if (cfg.minSuccess && successCount < cfg.minSuccess) {
                throw new Error(`Only ${successCount} destination(s) succeeded; required minSuccess=${cfg.minSuccess}`);
            }

            // Save manifest & finalize
            await this.db.query(
                `INSERT INTO backup_job_manifests (job_id, manifest) VALUES ($1, $2)
         ON CONFLICT (job_id) DO UPDATE SET manifest=$2`,
                [jobId, JSON.stringify(manifest)]
            );

            const durationSec = Math.max(1, Math.round((Date.now() - started) / 1000));
            await this.db.query(
                `UPDATE backup_jobs
           SET finished_at=NOW(),
               status='completed',
               size_bytes=$2,
               duration_sec=$3,
               verified=true,
               artifact_location=$4
         WHERE id=$1`,
                [jobId, stat.size, durationSec, JSON.stringify(artifactLoc)]
            );

            await this.appendLog(jobId, `Done in ${durationSec}s\n`);

            // Notify (best-effort)
            await this.notify(
                cfg.notifications,
                `Backup ${jobId} success`,
                `Size=${stat.size} Duration=${durationSec}s DestinationsOK=${successCount}`
            );
        } catch (e: any) {
            this.log.error(`Backup job ${jobId} failed: ${e?.message || e}`);
            await this.fail(jobId, e?.message || "Worker error");
            try {
                await this.notify(
                    cfg?.notifications ?? {},
                    `Backup ${jobId} failed`,
                    e?.message || "Worker error"
                );
            } catch { }
        } finally {
            // cleanup temp
            try {
                await fsp.rm(tmpRoot, { recursive: true, force: true });
            } catch { }
        }
    }

    private async fail(jobId: string, note: string) {
        await this.db.query(
            `UPDATE backup_jobs
          SET status='failed',
              finished_at=NOW(),
              note=$2
        WHERE id=$1`,
            [jobId, note]
        );
    }

    private async createTarGz(srcDir: string, outFile: string) {
        await new Promise<void>((resolve, reject) => {
            const output = fs.createWriteStream(outFile);
            const archive = archiver("tar", { gzip: true, gzipOptions: { level: 9 } });
            output.on("close", () => resolve());
            archive.on("error", (err) => reject(err));
            archive.pipe(output);
            archive.directory(srcDir, false);
            archive.finalize().catch(reject);
        });
    }

    /**
     * Map a logical target to candidate DB objects and return the first that exists.
     */
    private async resolveExistingTableForTarget(jobId: string, target: string): Promise<string | null> {
        const candidatesByTarget: Record<string, string[]> = {
            users: ["public.users", "users"],
            roles: ["public.roles", "roles"],
            devices: ["public.devices", "devices"],
            policies: ["public.policies", "policies"],
            audit_logs: ["public.audit_logs", "audit_logs", "public.auditlog", "auditlog"],
            settings: ["public.settings", "settings", "public.app_settings", "app_settings", "public.system_settings", "system_settings"],
            templates: ["public.templates", "templates"],
        };

        const candidates = candidatesByTarget[target] || [];
        for (const ident of candidates) {
            const reg = await this.db.query(`SELECT to_regclass($1) AS oid`, [ident]);
            const exists = !!reg.rows?.[0]?.oid;
            if (exists) return ident;
        }
        await this.appendLog(jobId, `    (no table/view found for target "${target}")\n`);
        return null;
    }

    /**
     * Load job config including the primary destination and fan-out destinations.
     */
    private async loadJobConfig(jobId: string): Promise<JobConfig | null> {
        const head = await this.db.query(
            `SELECT j.id,
              p.options,
              d.configuration AS destination_configuration
         FROM backup_jobs j
    LEFT JOIN backup_policies p ON j.policy_id = p.id
    LEFT JOIN backup_destinations d ON d.id = p.destination_id
        WHERE j.id=$1`,
            [jobId]
        );
        if (!head.rows.length) return null;

        const options = head.rows[0].options && typeof head.rows[0].options === "object" ? head.rows[0].options : {};
        if (options.enabled === false) return null;

        const destination = head.rows[0].destination_configuration || {};
        if (!destination.kind) return null;

        const targets = Array.isArray(options.targets) ? options.targets.filter(Boolean) : [];
        const notifications =
            options.notifications && typeof options.notifications === "object" ? options.notifications : {};
        const minSuccess =
            options.minSuccess != null ? Number(options.minSuccess) : undefined;
        const parallelism =
            options.parallelism != null ? Number(options.parallelism) : undefined;

        const extraRows = await this.db.query(
            `SELECT bjd.is_primary, bd.configuration
         FROM backup_job_destinations bjd
         JOIN backup_destinations bd ON bd.id = bjd.destination_id
        WHERE bjd.job_id=$1
        ORDER BY bjd.is_primary DESC, bjd.priority ASC`,
            [jobId]
        );

        const extras: FanoutDest[] = extraRows.rows
            .filter((r) => !r.is_primary)
            .map((r) => r.configuration as FanoutDest);

        return { targets, destination, notifications, extras, minSuccess, parallelism };
    }

    private async notify(
        channels: { email?: boolean; slack?: boolean; webhook?: boolean },
        subject: string,
        body: string
    ) {
        try {
            await this.notifier.send(channels || {}, subject, body);
        } catch (e) {
            this.log.warn(`Notify failed: ${e}`);
        }
    }

    /**
     * Copy/upload the finished archive to each extra destination. Best-effort:
     * returns how many succeeded. Runs with bounded concurrency.
     */
    private async replicateExtras(
        jobId: string,
        extras: FanoutDest[],
        localArchivePath: string,
        finalFileName: string,
        parallelism = 2
    ): Promise<number> {
        if (!extras?.length) return 0;

        const ordered = [...extras].sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));

        const tasks = ordered.map((dest) => async () => {
            try {
                if (dest.kind === "local") {
                    const out = path.join(dest.path, finalFileName);
                    await ensureDir(dest.path);
                    await fsp.copyFile(localArchivePath, out);
                    await this.appendLog(jobId, `[replica:local] ${out}\n`);
                    return true;
                } else if (dest.kind === "s3") {
                    const row = (
                        await this.db.query(
                            `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='s3'`,
                            [dest.connectionId]
                        )
                    ).rows[0];
                    if (!row) throw new Error("S3 connection not found");
                    const s3Cfg = { ...(row.config || {}), ...(row.secrets || {}) };
                    const bucket = dest.bucket || s3Cfg.bucket;
                    if (!bucket) throw new Error("S3 bucket missing");
                    const prefix = (dest.prefix || s3Cfg.prefix || "").replace(/^\/+|\/+$/g, "");
                    const key = (prefix ? `${prefix}/` : "") + finalFileName;
                    await s3PutObject(s3Cfg, bucket, key, fs.createReadStream(localArchivePath));
                    await this.appendLog(jobId, `[replica:s3] s3://${bucket}/${key}\n`);
                    return true;
                } else if (dest.kind === "nextcloud") {
                    const row = (
                        await this.db.query(
                            `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='nextcloud'`,
                            [dest.connectionId]
                        )
                    ).rows[0];
                    if (!row) throw new Error("Nextcloud connection not found");
                    const webdavUrl = row.config?.webdavUrl;
                    const username = row.config?.username;
                    const password = row.secrets?.password;
                    if (!webdavUrl || !username || !password || !dest.path) {
                        throw new Error("Nextcloud config incomplete");
                    }
                    await webdavUpload({
                        url: webdavUrl,
                        username,
                        password,
                        directory: dest.path,
                        filename: finalFileName,
                        body: fs.createReadStream(localArchivePath),
                    });
                    await this.appendLog(jobId, `[replica:nextcloud] ${dest.path}/${finalFileName}\n`);
                    return true;
                } else if (dest.kind === "gdrive") {
                    const row = (
                        await this.db.query(
                            `SELECT config, secrets FROM storage_connections WHERE id=$1 AND kind='gdrive'`,
                            [dest.connectionId]
                        )
                    ).rows[0];
                    if (!row) throw new Error("GDrive connection not found");
                    const credentialsJson = row.secrets?.serviceAccountJson;
                    const folderId: string | undefined = row.config?.folderId;
                    if (!credentialsJson || !folderId) throw new Error("GDrive connection incomplete");

                    await gdriveUpload({
                        credentialsJson,
                        folderId,
                        subfolder: dest.subfolder || undefined,
                        name: finalFileName,
                        body: fs.createReadStream(localArchivePath),
                    });
                    await this.appendLog(jobId, `[replica:gdrive] folderId=${folderId}${dest.subfolder ? `/${dest.subfolder}` : ""}/${finalFileName}\n`);
                    return true;
                } else if (dest.kind === "remote") {
                    await this.appendLog(jobId, `[replica:sftp] NOT IMPLEMENTED (skipped)\n`);
                    return false;
                } else {
                    await this.appendLog(jobId, `[replica:${(dest as any).kind}] Unknown kind (skipped)\n`);
                    return false;
                }
            } catch (err: any) {
                await this.appendLog(
                    jobId,
                    `[replica:${(dest as any).kind}] ERROR: ${(err?.message || String(err)).slice(0, 500)}\n`
                );
                return false;
            }
        });

        const settled = await this.pLimit(Math.max(1, Number(parallelism) || 2), tasks);
        return settled.reduce((ok, r) => ok + (r.status === "fulfilled" && r.value ? 1 : 0), 0);
    }
}
