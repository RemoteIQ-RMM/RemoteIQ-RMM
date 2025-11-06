BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS backup_destinations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    configuration jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS backup_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text NULL,
    schedule text NOT NULL,
    retention jsonb NOT NULL DEFAULT jsonb_build_object('days', 30),
    destination_id uuid NULL REFERENCES backup_destinations(id) ON DELETE SET NULL,
    target_type text NOT NULL DEFAULT 'organization',
    target_id uuid NULL,
    options jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS backup_jobs (
    id uuid PRIMARY KEY,
    policy_id uuid NULL REFERENCES backup_policies(id) ON DELETE SET NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NULL,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    note text NULL,
    size_bytes bigint NULL,
    duration_sec integer NULL,
    verified boolean NULL,
    cancelled boolean NOT NULL DEFAULT false,
    artifact_location jsonb NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backup_jobs_policy_idx ON backup_jobs (policy_id, started_at DESC);

CREATE TABLE IF NOT EXISTS backup_restores (
    id uuid PRIMARY KEY,
    backup_job_id uuid NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
    requested_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NULL,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    note text NULL
);

COMMIT;
