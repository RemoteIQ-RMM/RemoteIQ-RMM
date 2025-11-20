-- ===== BEGIN FILE: 20251107_multi_destination_backups.sql =====
-- Enable multi-destination backups without breaking existing single-destination flows.
-- Idempotent and safe to re-run.

-- 1) Policy → many destinations (keeps backup_policies.destination_id for legacy)
CREATE TABLE IF NOT EXISTS public.backup_policy_destinations (
  policy_id      UUID NOT NULL REFERENCES public.backup_policies(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES public.backup_destinations(id) ON DELETE RESTRICT,
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  priority       INTEGER  NOT NULL DEFAULT 100, -- lower = preferred
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (policy_id, destination_id)
);

-- Backfill: if a policy had a single destination_id, make it its primary with priority 10
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='backup_policies' AND column_name='destination_id')
  THEN
    INSERT INTO public.backup_policy_destinations (policy_id, destination_id, is_primary, priority, created_at)
    SELECT p.id, p.destination_id, TRUE, 10, NOW()
    FROM public.backup_policies p
    WHERE p.destination_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.backup_policy_destinations d
        WHERE d.policy_id = p.id AND d.destination_id = p.destination_id
      );
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2) Jobs table knobs: how many destinations must succeed; parallel fan-out
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='backup_jobs' AND column_name='min_success'
  ) THEN
    ALTER TABLE public.backup_jobs ADD COLUMN min_success INTEGER NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='backup_jobs' AND column_name='parallelism'
  ) THEN
    ALTER TABLE public.backup_jobs ADD COLUMN parallelism INTEGER NOT NULL DEFAULT 2;
  END IF;

  -- Optional: capture the canonical archive file name and checksum on the job
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='backup_jobs' AND column_name='archive_name'
  ) THEN
    ALTER TABLE public.backup_jobs ADD COLUMN archive_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='backup_jobs' AND column_name='checksum'
  ) THEN
    ALTER TABLE public.backup_jobs ADD COLUMN checksum TEXT;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 3) Job snapshot of destinations at run time (based on policy settings)
CREATE TABLE IF NOT EXISTS public.backup_job_destinations (
  job_id         UUID NOT NULL REFERENCES public.backup_jobs(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES public.backup_destinations(id) ON DELETE RESTRICT,
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  priority       INTEGER  NOT NULL DEFAULT 100,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, destination_id)
);

CREATE INDEX IF NOT EXISTS idx_bjd_job ON public.backup_job_destinations(job_id);
CREATE INDEX IF NOT EXISTS idx_bjd_dest ON public.backup_job_destinations(destination_id);

-- 4) Per-destination run status (write/read/verify/prune phases, errors, etc.)
CREATE TABLE IF NOT EXISTS public.backup_run_destinations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES public.backup_jobs(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES public.backup_destinations(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL CHECK (status IN ('pending','running','ok','warning','failed')) DEFAULT 'pending',
  phases         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- e.g. {"write":true,"read":true,"verify":true,"prune":false}
  error          TEXT,
  remote_path    TEXT,          -- S3 key / WebDAV path / SFTP path / Drive file id
  size_bytes     BIGINT,
  etag           TEXT,          -- S3 etag or provider-equivalent
  checksum       TEXT,          -- sha256 of archive (matches backup_jobs.checksum)
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brd_job ON public.backup_run_destinations(job_id);
CREATE INDEX IF NOT EXISTS idx_brd_dest ON public.backup_run_destinations(destination_id);
CREATE INDEX IF NOT EXISTS idx_brd_status ON public.backup_run_destinations(status);

-- 5) Helper view (optional): per-job quick summary
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='v_backup_job_destination_summary'
  ) THEN
    CREATE VIEW public.v_backup_job_destination_summary AS
    SELECT
      j.id AS job_id,
      COUNT(r.id) AS dest_count,
      COUNT(*) FILTER (WHERE r.status IN ('ok','warning')) AS dest_ok_or_warn,
      COUNT(*) FILTER (WHERE r.status = 'ok') AS dest_ok,
      COUNT(*) FILTER (WHERE r.status = 'failed') AS dest_failed,
      MIN(j.min_success) AS min_success
    FROM public.backup_jobs j
    LEFT JOIN public.backup_run_destinations r ON r.job_id = j.id
    GROUP BY j.id;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 6) (Optional) Backward compatibility note:
--    Existing code that reads backup_policies.destination_id still works.
--    New code should read from backup_policy_destinations and copy to backup_job_destinations at job enqueue time.

-- ===== END FILE: 20251107_multi_destination_backups.sql =====
