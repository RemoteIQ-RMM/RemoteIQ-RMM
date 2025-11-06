BEGIN;

CREATE TABLE IF NOT EXISTS backups_config (
    id text PRIMARY KEY DEFAULT 'singleton',
    enabled boolean NOT NULL DEFAULT false,
    targets jsonb NOT NULL DEFAULT '[]' :: jsonb,
    schedule text NOT NULL CHECK (schedule IN ('hourly', 'daily', 'weekly', 'cron')),
    cron_expr text,
    retention_days integer NOT NULL DEFAULT 30 CHECK (
        retention_days BETWEEN 1
        AND 3650
    ),
    encrypt boolean NOT NULL DEFAULT true,
    destination jsonb NOT NULL,
    notifications jsonb NOT NULL DEFAULT '{}' :: jsonb
);

CREATE TABLE IF NOT EXISTS backup_jobs (
    id uuid PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NULL,
    status text NOT NULL CHECK (
        status IN ('running', 'success', 'failed', 'cancelled')
    ),
    note text NULL,
    size_bytes bigint NULL,
    duration_sec integer NULL,
    verified boolean NULL,
    -- optional snapshot columns for future use
    targets jsonb NULL,
    destination jsonb NULL
);

CREATE INDEX IF NOT EXISTS backup_jobs_started_at_desc ON backup_jobs (started_at DESC);

CREATE INDEX IF NOT EXISTS backup_jobs_status_idx ON backup_jobs (status);

CREATE TABLE IF NOT EXISTS backup_restores (
    id uuid PRIMARY KEY,
    backup_id uuid NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
    requested_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NULL,
    status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    note text NULL
);

-- Storage connections table (assumed already exists). If not, define minimally:
-- CREATE TABLE storage_connections (
--   id uuid PRIMARY KEY,
--   name text NOT NULL,
--   kind text NOT NULL CHECK (kind IN ('s3','nextcloud','gdrive','sftp')),
--   config jsonb NOT NULL,
--   secrets jsonb NOT NULL DEFAULT '{}'::jsonb
-- );
COMMIT;