BEGIN;

-- Where the archive lives (for download/restore)
ALTER TABLE
    backup_jobs
ADD
    COLUMN IF NOT EXISTS artifact_location jsonb,
    -- e.g. {"kind":"local","path":"/..."} or {"kind":"s3","bucket":"...","key":"..."}
ADD
    COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

-- Text log stored in DB (fast & simple). If you want file logs, we can switch later.
CREATE TABLE IF NOT EXISTS backup_job_logs (
    job_id uuid PRIMARY KEY REFERENCES backup_jobs(id) ON DELETE CASCADE,
    log_text text NOT NULL DEFAULT ''
);

-- Manifest (what we exported; counts per target, file names, checksums, etc.)
CREATE TABLE IF NOT EXISTS backup_job_manifests (
    job_id uuid PRIMARY KEY REFERENCES backup_jobs(id) ON DELETE CASCADE,
    manifest jsonb NOT NULL
);

-- Track the last scheduler tick to avoid double-firing across restarts
ALTER TABLE
    backups_config
ADD
    COLUMN IF NOT EXISTS last_scheduled_at timestamptz;

COMMIT;