import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import archiver from "archiver";
import { PgPoolService } from "../storage/pg-pool.service";
import { s3PutObject, s3Head, ensureDir } from "./storage-clients";
import { NotifierService } from "./notifier.service";

type Job = { id: string; status: string; cancelled: boolean };

@Injectable()
export class WorkerService {
    private log = new Logger("BackupsWorker");
    private running = false;

    constructor(
        private readonly db: PgPoolService,
        private readonly notifier: NotifierService
    ) { }

    /**
     * Picks the oldest running job (inserted as 'running' by BackupsService.startBackupNow)
     * and processes it. Re-entrant safe; returns immediately if a run is in progress.
     */
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
        // Select oldest running job (already set to 'running' by the service)
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

    /**
     * Process a single job:
     *  - export selected targets to NDJSON (skip missing)
     *  - tar.gz into an archive
     *  - write to local path or upload to S3
     *  - persist manifest/log
     *  - mark success
     */
    async process(jobId: string) {
        const started = Date.now();

        const cfgRow = await this.db.query(
            `SELECT enabled, targets, destination, notifications
         FROM backups_config
        LIMIT 1`
        );
        if (!cfgRow.rows.length || !cfgRow.rows[0].enabled) {
            await this.fail(jobId, "Backups disabled");
            return;
        }
        const cfg = cfgRow.rows[0] as {
            enabled: boolean;
            targets: string[];
            destination:
            | { kind: "local"; path: string }
            | { kind: "s3"; connectionId: string; bucket?: string; prefix?: string }
            | { kind: "nextcloud"; connectionId: string; path: string }
            | { kind: "gdrive"; connectionId: string; subfolder?: string }
            | { kind: "remote"; connectionId: string; path: string };
            notifications?: { email?: boolean; slack?: boolean; webhook?: boolean };
        };

        const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "remoteiq-bkp-"));
        const exportDir = path.join(tmpRoot, "export");
        await ensureDir(exportDir);

        try {
            // Export targets -> NDJSON files
            const targets: string[] =
                Array.isArray(cfg.targets) && cfg.targets.length
                    ? cfg.targets
                    : ["users", "devices", "settings"];

            const manifest: any = {
                id: jobId,
                targets,
                files: [],
                counts: {},
                createdAt: new Date().toISOString(),
            };

            await this.appendLog(jobId, `Exporting targets: ${targets.join(", ")}\n`);

            for (const t of targets) {
                // Resolve an existing table/view for this logical target (or skip)
                const table = await this.resolveExistingTableForTarget(jobId, t);
                if (!table) {
                    await this.appendLog(
                        jobId,
                        `  - ${t}: skipped (no mapped table/view exists)\n`
                    );
                    manifest.counts[t] = 0;
                    continue;
                }

                // Export rows to NDJSON
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
                    // If the table disappeared between resolve and select, log and skip
                    await new Promise((r) => ws.end(r));
                    await this.appendLog(
                        jobId,
                        `  - ${t}: error reading ${table} → ${e?.message || e}; skipped\n`
                    );
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
            await this.appendLog(
                jobId,
                `Archive created: ${archiveName} (${stat.size} bytes)\n`
            );

            // Upload per destination
            const dest = cfg.destination as any;
            let artifactLoc: any = null;

            if (dest.kind === "local") {
                const full = path.join(dest.path, path.basename(archivePath));
                await ensureDir(dest.path);
                await fsp.copyFile(archivePath, full);
                artifactLoc = { kind: "local", path: full };
                await this.appendLog(jobId, `Saved to local path: ${full}\n`);
            } else if (dest.kind === "s3") {
                // Pull secrets from storage_connections
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
                    region: cfgS3.region,
                    endpoint: cfgS3.endpoint,
                };
                await this.appendLog(jobId, `Uploaded to s3://${bucket}/${key}\n`);
            } else {
                throw new Error(
                    `Destination kind '${dest.kind}' not supported for upload yet`
                );
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
               status='success',
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
                cfg,
                true,
                `Backup ${jobId} success`,
                `Size=${stat.size} Duration=${durationSec}s`
            );
        } catch (e: any) {
            this.log.error(`Backup job ${jobId} failed: ${e?.message || e}`);
            await this.fail(jobId, e?.message || "Worker error");
            // try to notify failure, best-effort
            try {
                await this.notify(
                    cfgRow.rows[0],
                    false,
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
     * Uses to_regclass to test existence safely (prevents injection via fixed mapping).
     */
    private async resolveExistingTableForTarget(jobId: string, target: string): Promise<string | null> {
        // Strict, explicit mapping only (no user input becomes SQL identifiers).
        // Add/adjust candidates here to match your schema names.
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
        // log a one-liner for visibility
        await this.appendLog(jobId, `    (no table/view found for target "${target}")\n`);
        return null;
    }

    private async notify(
        cfgRow: any,
        ok: boolean,
        subject: string,
        body: string
    ) {
        const channels = (cfgRow.notifications || {}) as {
            email?: boolean;
            slack?: boolean;
            webhook?: boolean;
        };
        try {
            await this.notifier.send(channels, subject, body);
        } catch (e) {
            this.log.warn(`Notify failed: ${e}`);
        }
    }
}
