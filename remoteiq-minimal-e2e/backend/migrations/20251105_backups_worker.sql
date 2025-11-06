BEGIN;

-- Where the archive lives (for download/restore)
ALTER TABLE
    backup_jobs
ADD
    COLUMN IF NOT EXISTS artifact_location jsonb,
ADD
    COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

-- Text log stored in DB (fast & simple). If you want file logs, we can switch later.
CREATE TABLE IF NOT EXISTS backup_job_logs (
    job_id uuid PRIMARY KEY REFERENCES backup_jobs(id) ON DELETE CASCADE,
    log_text text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Manifest (what we exported; counts per target, file names, checksums, etc.)
CREATE TABLE IF NOT EXISTS backup_job_manifests (
    job_id uuid PRIMARY KEY REFERENCES backup_jobs(id) ON DELETE CASCADE,
    manifest jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
