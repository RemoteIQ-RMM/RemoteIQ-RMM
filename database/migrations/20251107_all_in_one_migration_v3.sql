-- ============================================================================
-- RemoteIQ: All-in-one consolidated migration (v3) + Multi-destination Backups
-- Generated: 2025-11-07 17:28:21
-- This script merges all app migrations into ONE idempotent file.
-- Notes:
--   * Nested BEGIN/COMMIT statements are stripped from source files.
--   * Most blocks are idempotent to allow safe re-runs.
--   * Multi-destination backups added after Backups base tables.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Compatibility patch for localization_settings columns referenced later
-- Adds columns if they don't exist so later INSERT/UPDATE statements succeed.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='language'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN language TEXT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='time_zone'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN time_zone TEXT;
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;

-- End compatibility patch

-- ===== BEGIN FILE: 20240101_redesign.sql =====
-- RemoteIQ database redesign schema
-- This script defines the normalized schema described in docs/database_redesign_plan.md
-- It can be applied to a clean database or used as a reference for building
-- incremental migrations from the legacy schema found in remoteiq_full.sql.


CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Shared enums --------------------------------------------------------------

CREATE TYPE user_status AS ENUM ('active', 'invited', 'disabled');
CREATE TYPE role_scope AS ENUM ('system', 'organization');
CREATE TYPE device_status AS ENUM ('online', 'offline', 'retired', 'decommissioned');
CREATE TYPE agent_task_type AS ENUM ('script', 'policy', 'update', 'command');
CREATE TYPE agent_task_status AS ENUM ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE check_type AS ENUM ('ping', 'service', 'process', 'metric', 'script');
CREATE TYPE check_target_type AS ENUM ('organization', 'client', 'site', 'device');
CREATE TYPE check_status AS ENUM ('passed', 'warning', 'failed', 'muted');
CREATE TYPE check_severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
CREATE TYPE backup_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE ticket_status AS ENUM ('open', 'pending', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE email_channel_purpose AS ENUM ('alerts', 'support', 'marketing', 'system');

-- Generic trigger for updated_at -------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Core platform -------------------------------------------------------------

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  branding JSONB NOT NULL DEFAULT '{}'::JSONB,
  localization JSONB NOT NULL DEFAULT '{}'::JSONB,
  support JSONB NOT NULL DEFAULT '{}'::JSONB,
  notifications JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_organization_settings_updated
BEFORE UPDATE ON organization_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE support_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_key TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  configuration JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, channel_key)
);

CREATE TRIGGER trg_support_channels_updated
BEFORE UPDATE ON support_channels
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Storage connectors -------------------------------------------------------

CREATE TABLE storage_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('s3', 'nextcloud', 'gdrive', 'sftp')),
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  secrets JSONB NOT NULL DEFAULT '{}'::JSONB,
  meta JSONB NOT NULL DEFAULT '{}'::JSONB,
  capabilities JSONB NOT NULL DEFAULT '{}'::JSONB,
  health JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_storage_connections_updated
BEFORE UPDATE ON storage_connections
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Authentication & authorization -------------------------------------------

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email CITEXT NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  status user_status NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, email)
);

CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_security (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret TEXT,
  recovery_codes TEXT[],
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_security_updated
BEFORE UPDATE ON user_security
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  scope role_scope NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_roles_scope_name UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_roles_updated
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE permissions (
  permission_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  group_key TEXT NOT NULL,
  group_label TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_permissions_updated
BEFORE UPDATE ON permissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  user_agent TEXT,
  ip_address INET,
  trusted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE personal_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  description TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE login_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clients, sites, devices, agents -----------------------------------------

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  external_ref TEXT,
  contact JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_clients_updated
BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, name)
);

CREATE TRIGGER trg_sites_updated
BEFORE UPDATE ON sites
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  hostname TEXT NOT NULL,
  serial_number TEXT,
  operating_system TEXT,
  architecture TEXT,
  status device_status NOT NULL DEFAULT 'online',
  primary_user TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, hostname)
);

CREATE TRIGGER trg_devices_updated
BEFORE UPDATE ON devices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
  agent_uuid UUID NOT NULL UNIQUE,
  version TEXT NOT NULL,
  last_check_in_at TIMESTAMPTZ,
  facts JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_agents_updated
BEFORE UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE agent_software (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  publisher TEXT,
  version TEXT,
  install_location TEXT,
  install_date TIMESTAMPTZ,
  uninstall_command TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_software_agent ON agent_software(agent_id);
CREATE INDEX idx_agent_software_name ON agent_software(name);

CREATE TRIGGER trg_agent_software_updated
BEFORE UPDATE ON agent_software
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type agent_task_type NOT NULL,
  description TEXT,
  script TEXT,
  configuration JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_automations_updated
BEFORE UPDATE ON automations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type agent_task_type NOT NULL,
  payload JSONB NOT NULL,
  status agent_task_status NOT NULL DEFAULT 'pending',
  queued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_tasks_agent_status ON agent_tasks(agent_id, status);

CREATE TRIGGER trg_agent_tasks_updated
BEFORE UPDATE ON agent_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE agent_task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL DEFAULT 1,
  status agent_task_status NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_task_runs_task ON agent_task_runs(task_id);

CREATE TABLE agent_task_results (
  run_id UUID PRIMARY KEY REFERENCES agent_task_runs(id) ON DELETE CASCADE,
  stdout TEXT,
  stderr TEXT,
  artifacts JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  task_run_id UUID REFERENCES agent_task_runs(id) ON DELETE SET NULL,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status agent_task_status NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  output JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Monitoring ---------------------------------------------------------------

CREATE TABLE checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type check_type NOT NULL,
  category TEXT,
  description TEXT,
  schedule TEXT NOT NULL,
  config JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_checks_updated
BEFORE UPDATE ON checks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE check_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_check_profiles_updated
BEFORE UPDATE ON check_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE check_profile_members (
  profile_id UUID NOT NULL REFERENCES check_profiles(id) ON DELETE CASCADE,
  check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, check_id)
);

CREATE TABLE check_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  target_type check_target_type NOT NULL,
  target_id UUID NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_check_assignments_target ON check_assignments(target_type, target_id);

CREATE TRIGGER trg_check_assignments_updated
BEFORE UPDATE ON check_assignments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE check_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES check_assignments(id) ON DELETE CASCADE,
  status check_status NOT NULL,
  severity check_severity NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  metrics JSONB,
  output TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_check_runs_assignment ON check_runs(assignment_id, started_at DESC);

-- Backups -----------------------------------------------------------------

CREATE TABLE backup_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  configuration JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_backup_destinations_updated
BEFORE UPDATE ON backup_destinations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE backup_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schedule TEXT NOT NULL,
  retention JSONB NOT NULL,
  destination_id UUID REFERENCES backup_destinations(id) ON DELETE SET NULL,
  target_type check_target_type NOT NULL,
  target_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  options JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_backup_policies_updated
BEFORE UPDATE ON backup_policies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE backups_config (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  targets JSONB NOT NULL DEFAULT '[]'::JSONB,
  schedule TEXT NOT NULL DEFAULT 'daily',
  cron_expr TEXT,
  retention_days INTEGER NOT NULL DEFAULT 30,
  encrypt BOOLEAN NOT NULL DEFAULT TRUE,
  destination JSONB NOT NULL DEFAULT '{}'::JSONB,
  notifications JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_backups_config_updated
BEFORE UPDATE ON backups_config
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE backup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID REFERENCES backup_policies(id) ON DELETE SET NULL,
  status backup_status NOT NULL,
  note TEXT,
  size_bytes BIGINT,
  duration_sec INTEGER,
  verified BOOLEAN,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  artifact_location JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backup_jobs_policy ON backup_jobs(policy_id, started_at DESC);

CREATE TABLE backup_job_logs (
  job_id UUID PRIMARY KEY REFERENCES backup_jobs(id) ON DELETE CASCADE,
  log_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_backup_job_logs_updated
BEFORE UPDATE ON backup_job_logs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE backup_job_manifests (
  job_id UUID PRIMARY KEY REFERENCES backup_jobs(id) ON DELETE CASCADE,
  manifest JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_backup_job_manifests_updated
BEFORE UPDATE ON backup_job_manifests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE backup_job_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_job_id UUID NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  storage_location TEXT NOT NULL,
  size_bytes BIGINT,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE backup_restores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_job_id UUID NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status backup_status NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_backup_restores_updated
BEFORE UPDATE ON backup_restores
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- Multi-destination Backups (NEW)
-- Inserted right after Backups base tables
-- ===== BEGIN FILE: 20251107_multi_destination_backups.sql =====

-- 1) Policy → many destinations (keeps backup_policies.destination_id for legacy)
CREATE TABLE IF NOT EXISTS public.backup_policy_destinations (
  policy_id      UUID NOT NULL REFERENCES public.backup_policies(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES public.backup_destinations(id) ON DELETE RESTRICT,
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  priority       INTEGER  NOT NULL DEFAULT 100, -- lower = preferred
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (policy_id, destination_id)
);

-- Backfill: single destination_id → primary record
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

-- 2) Jobs table knobs: min_success, parallelism, plus optional archive_name/checksum
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

-- 3) Job snapshot of destinations at run time
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

-- 4) Per-destination run status
CREATE TABLE IF NOT EXISTS public.backup_run_destinations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES public.backup_jobs(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES public.backup_destinations(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL CHECK (status IN ('pending','running','ok','warning','failed')) DEFAULT 'pending',
  phases         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"write":true,"read":true,"verify":true,"prune":false}
  error          TEXT,
  remote_path    TEXT,
  size_bytes     BIGINT,
  etag           TEXT,
  checksum       TEXT,
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brd_job ON public.backup_run_destinations(job_id);
CREATE INDEX IF NOT EXISTS idx_brd_dest ON public.backup_run_destinations(destination_id);
CREATE INDEX IF NOT EXISTS idx_brd_status ON public.backup_run_destinations(status);

-- 5) Summary view (optional)
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

-- ===== END FILE: 20251107_multi_destination_backups.sql =====
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Tickets & support -------------------------------------------------------

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email CITEXT,
  phone TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_contacts_updated
BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_number BIGINT NOT NULL,
  requester_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  description TEXT,
  status ticket_status NOT NULL DEFAULT 'open',
  priority ticket_priority NOT NULL DEFAULT 'normal',
  assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  UNIQUE (organization_id, ticket_number)
);

CREATE TRIGGER trg_tickets_updated
BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ticket_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  message TEXT,
  status ticket_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_updates_ticket ON ticket_updates(ticket_id, created_at DESC);

CREATE TABLE ticket_tags (
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, tag)
);

CREATE TABLE ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email & messaging -------------------------------------------------------

CREATE TABLE email_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose email_channel_purpose NOT NULL,
  is_inbound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_outbound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  imap_settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

CREATE TRIGGER trg_email_channels_updated
BEFORE UPDATE ON email_channels
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE email_ingest_state (
  channel_id UUID PRIMARY KEY REFERENCES email_channels(id) ON DELETE CASCADE,
  last_uid BIGINT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_email_ingest_state_updated
BEFORE UPDATE ON email_ingest_state
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES email_channels(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_id TEXT,
  subject TEXT,
  from_address TEXT,
  to_addresses TEXT[],
  cc_addresses TEXT[],
  bcc_addresses TEXT[],
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_messages_channel ON email_messages(channel_id, received_at DESC);

CREATE TABLE dkim_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, domain)
);

CREATE TRIGGER trg_dkim_domains_updated
BEFORE UPDATE ON dkim_domains
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dkim_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dkim_domain_id UUID NOT NULL REFERENCES dkim_domains(id) ON DELETE CASCADE,
  selector TEXT NOT NULL,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  UNIQUE (dkim_domain_id, selector)
);

-- Auditing ----------------------------------------------------------------

CREATE TABLE organization_setting_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  settings_type TEXT NOT NULL,
  previous JSONB,
  next JSONB,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ===== END FILE: 20240101_redesign.sql =====


-- ===== BEGIN FILE: 20251106_create_company_profile.sql =====
-- Creates/repairs the single-row company profile table expected by CompanyService.
-- Safe to run multiple times (idempotent).


-- 1) Create table if not exists
CREATE TABLE IF NOT EXISTS public.company_profile (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  legal_name TEXT,
  email      TEXT,
  phone      TEXT,
  fax        TEXT,
  website    TEXT,
  vat_tin    TEXT,
  address1   TEXT,
  address2   TEXT,
  city       TEXT,
  state      TEXT,
  postal     TEXT,
  country    TEXT
);

-- 2) Add any missing columns (handles older/different layouts)
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','name','sql','ALTER TABLE public.company_profile ADD COLUMN name TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','legal_name','sql','ALTER TABLE public.company_profile ADD COLUMN legal_name TEXT'),
    jsonb_build_object('name','email','sql','ALTER TABLE public.company_profile ADD COLUMN email TEXT'),
    jsonb_build_object('name','phone','sql','ALTER TABLE public.company_profile ADD COLUMN phone TEXT'),
    jsonb_build_object('name','fax','sql','ALTER TABLE public.company_profile ADD COLUMN fax TEXT'),
    jsonb_build_object('name','website','sql','ALTER TABLE public.company_profile ADD COLUMN website TEXT'),
    jsonb_build_object('name','vat_tin','sql','ALTER TABLE public.company_profile ADD COLUMN vat_tin TEXT'),
    jsonb_build_object('name','address1','sql','ALTER TABLE public.company_profile ADD COLUMN address1 TEXT'),
    jsonb_build_object('name','address2','sql','ALTER TABLE public.company_profile ADD COLUMN address2 TEXT'),
    jsonb_build_object('name','city','sql','ALTER TABLE public.company_profile ADD COLUMN city TEXT'),
    jsonb_build_object('name','state','sql','ALTER TABLE public.company_profile ADD COLUMN state TEXT'),
    jsonb_build_object('name','postal','sql','ALTER TABLE public.company_profile ADD COLUMN postal TEXT'),
    jsonb_build_object('name','country','sql','ALTER TABLE public.company_profile ADD COLUMN country TEXT')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'company_profile'
        AND column_name = (c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END$$;

-- 3) Ensure the singleton row id=1 exists (with a default name if blank)
INSERT INTO public.company_profile (id, name)
VALUES (1, 'Your Company')
ON CONFLICT (id) DO NOTHING;

-- If the name is empty, give it a sensible default.
UPDATE public.company_profile
   SET name = COALESCE(NULLIF(name, ''), 'Your Company')
 WHERE id = 1;
-- ===== END FILE: 20251106_create_company_profile.sql =====


-- ===== BEGIN FILE: 20251106_create_dkim_settings.sql =====
-- Creates/repairs the single-row dkim_settings table used by DkimRepository.
-- Safe to run multiple times.


CREATE TABLE IF NOT EXISTS public.dkim_settings (
  id          INTEGER PRIMARY KEY,
  domain      TEXT NOT NULL DEFAULT '',
  selector    TEXT NOT NULL DEFAULT '',
  private_key TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure all columns exist
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','domain','sql','ALTER TABLE public.dkim_settings ADD COLUMN domain TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','selector','sql','ALTER TABLE public.dkim_settings ADD COLUMN selector TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','private_key','sql','ALTER TABLE public.dkim_settings ADD COLUMN private_key TEXT'),
    jsonb_build_object('name','updated_at','sql','ALTER TABLE public.dkim_settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='dkim_settings'
        AND column_name=(c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END$$;

-- Seed the singleton row (id=1) if missing
INSERT INTO public.dkim_settings (id, domain, selector, private_key)
VALUES (1, '', '', NULL)
ON CONFLICT (id) DO NOTHING;
-- ===== END FILE: 20251106_create_dkim_settings.sql =====


-- ===== BEGIN FILE: 20251106_create_email_settings.sql =====
-- Creates/repairs the email_settings table used by SmtpRepository.
-- Safe to run multiple times.


CREATE TABLE IF NOT EXISTS public.email_settings (
  purpose            TEXT PRIMARY KEY,  -- 'alerts' | 'invites' | 'password_resets' | 'reports'
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,

  smtp_host          TEXT NOT NULL DEFAULT '',
  smtp_port          INTEGER,
  smtp_username      TEXT NOT NULL DEFAULT '',
  smtp_password      TEXT,
  smtp_use_tls       BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_use_ssl       BOOLEAN NOT NULL DEFAULT FALSE,
  smtp_from_address  TEXT NOT NULL DEFAULT '',

  imap_host          TEXT NOT NULL DEFAULT '',
  imap_port          INTEGER,
  imap_username      TEXT NOT NULL DEFAULT '',
  imap_password      TEXT,
  imap_use_ssl       BOOLEAN NOT NULL DEFAULT TRUE,

  pop_host           TEXT NOT NULL DEFAULT '',
  pop_port           INTEGER,
  pop_username       TEXT NOT NULL DEFAULT '',
  pop_password       TEXT,
  pop_use_ssl        BOOLEAN NOT NULL DEFAULT TRUE,

  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns (idempotent)
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','enabled','sql','ALTER TABLE public.email_settings ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE'),
    jsonb_build_object('name','smtp_host','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_host TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','smtp_port','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_port INTEGER'),
    jsonb_build_object('name','smtp_username','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_username TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','smtp_password','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_password TEXT'),
    jsonb_build_object('name','smtp_use_tls','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_use_tls BOOLEAN NOT NULL DEFAULT TRUE'),
    jsonb_build_object('name','smtp_use_ssl','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_use_ssl BOOLEAN NOT NULL DEFAULT FALSE'),
    jsonb_build_object('name','smtp_from_address','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_from_address TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','imap_host','sql','ALTER TABLE public.email_settings ADD COLUMN imap_host TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','imap_port','sql','ALTER TABLE public.email_settings ADD COLUMN imap_port INTEGER'),
    jsonb_build_object('name','imap_username','sql','ALTER TABLE public.email_settings ADD COLUMN imap_username TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','imap_password','sql','ALTER TABLE public.email_settings ADD COLUMN imap_password TEXT'),
    jsonb_build_object('name','imap_use_ssl','sql','ALTER TABLE public.email_settings ADD COLUMN imap_use_ssl BOOLEAN NOT NULL DEFAULT TRUE'),
    jsonb_build_object('name','pop_host','sql','ALTER TABLE public.email_settings ADD COLUMN pop_host TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','pop_port','sql','ALTER TABLE public.email_settings ADD COLUMN pop_port INTEGER'),
    jsonb_build_object('name','pop_username','sql','ALTER TABLE public.email_settings ADD COLUMN pop_username TEXT NOT NULL DEFAULT ''''' ),
    jsonb_build_object('name','pop_password','sql','ALTER TABLE public.email_settings ADD COLUMN pop_password TEXT'),
    jsonb_build_object('name','pop_use_ssl','sql','ALTER TABLE public.email_settings ADD COLUMN pop_use_ssl BOOLEAN NOT NULL DEFAULT TRUE'),
    jsonb_build_object('name','updated_at','sql','ALTER TABLE public.email_settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='email_settings'
        AND column_name = (c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END$$;

-- Seed defaults for required purposes if missing (without overwriting)
INSERT INTO public.email_settings (purpose, enabled, smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, smtp_use_ssl, smtp_from_address,
                                   imap_host, imap_port, imap_username, imap_password, imap_use_ssl,
                                   pop_host, pop_port, pop_username, pop_password, pop_use_ssl, updated_at)
SELECT x.purpose, TRUE, '', 587, '', NULL, TRUE, FALSE, '',
       '', 993, '', NULL, TRUE,
       '', 995, '', NULL, TRUE, NOW()
FROM (VALUES ('alerts'), ('invites'), ('password_resets'), ('reports')) AS x(purpose)
WHERE NOT EXISTS (SELECT 1 FROM public.email_settings s WHERE s.purpose = x.purpose);
-- ===== END FILE: 20251106_create_email_settings.sql =====


-- ===== BEGIN FILE: 20251106_create_support_legal.sql =====
-- Creates/repairs the single-row support_legal table expected by SupportLegalService.
-- Safe to run multiple times.


-- 1) Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.support_legal (
  id                 INTEGER PRIMARY KEY,
  support_email      TEXT,
  support_phone      TEXT,
  knowledge_base_url TEXT,
  status_page_url    TEXT,
  privacy_policy_url TEXT,
  terms_url          TEXT,
  gdpr_contact_email TEXT,
  legal_address      TEXT,
  ticket_portal_url  TEXT,
  phone_hours        TEXT,
  notes_html         TEXT
);

-- 2) Add any missing columns (idempotent)
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','support_email','sql','ALTER TABLE public.support_legal ADD COLUMN support_email TEXT'),
    jsonb_build_object('name','support_phone','sql','ALTER TABLE public.support_legal ADD COLUMN support_phone TEXT'),
    jsonb_build_object('name','knowledge_base_url','sql','ALTER TABLE public.support_legal ADD COLUMN knowledge_base_url TEXT'),
    jsonb_build_object('name','status_page_url','sql','ALTER TABLE public.support_legal ADD COLUMN status_page_url TEXT'),
    jsonb_build_object('name','privacy_policy_url','sql','ALTER TABLE public.support_legal ADD COLUMN privacy_policy_url TEXT'),
    jsonb_build_object('name','terms_url','sql','ALTER TABLE public.support_legal ADD COLUMN terms_url TEXT'),
    jsonb_build_object('name','gdpr_contact_email','sql','ALTER TABLE public.support_legal ADD COLUMN gdpr_contact_email TEXT'),
    jsonb_build_object('name','legal_address','sql','ALTER TABLE public.support_legal ADD COLUMN legal_address TEXT'),
    jsonb_build_object('name','ticket_portal_url','sql','ALTER TABLE public.support_legal ADD COLUMN ticket_portal_url TEXT'),
    jsonb_build_object('name','phone_hours','sql','ALTER TABLE public.support_legal ADD COLUMN phone_hours TEXT'),
    jsonb_build_object('name','notes_html','sql','ALTER TABLE public.support_legal ADD COLUMN notes_html TEXT')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='support_legal'
        AND column_name = (c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END$$;

-- 3) Ensure the singleton row exists
INSERT INTO public.support_legal (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
-- ===== END FILE: 20251106_create_support_legal.sql =====



-- ===== BEGIN FILE: 20251107_create_branding_settings.sql =====
-- Creates/repairs the single-row branding_settings table used by BrandingService.
CREATE TABLE IF NOT EXISTS public.branding_settings (
  id                           INTEGER PRIMARY KEY,
  primary_color                TEXT,
  secondary_color              TEXT,
  logo_light_url               TEXT,
  logo_dark_url                TEXT,
  login_background_url         TEXT,
  favicon_url                  TEXT,
  email_header                 TEXT,
  email_footer                 TEXT,
  custom_css                   TEXT,
  allow_client_theme_toggle    BOOLEAN
);

-- Ensure columns exist (idempotent)
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','primary_color','sql','ALTER TABLE public.branding_settings ADD COLUMN primary_color TEXT'),
    jsonb_build_object('name','secondary_color','sql','ALTER TABLE public.branding_settings ADD COLUMN secondary_color TEXT'),
    jsonb_build_object('name','logo_light_url','sql','ALTER TABLE public.branding_settings ADD COLUMN logo_light_url TEXT'),
    jsonb_build_object('name','logo_dark_url','sql','ALTER TABLE public.branding_settings ADD COLUMN logo_dark_url TEXT'),
    jsonb_build_object('name','login_background_url','sql','ALTER TABLE public.branding_settings ADD COLUMN login_background_url TEXT'),
    jsonb_build_object('name','favicon_url','sql','ALTER TABLE public.branding_settings ADD COLUMN favicon_url TEXT'),
    jsonb_build_object('name','email_header','sql','ALTER TABLE public.branding_settings ADD COLUMN email_header TEXT'),
    jsonb_build_object('name','email_footer','sql','ALTER TABLE public.branding_settings ADD COLUMN email_footer TEXT'),
    jsonb_build_object('name','custom_css','sql','ALTER TABLE public.branding_settings ADD COLUMN custom_css TEXT'),
    jsonb_build_object('name','allow_client_theme_toggle','sql','ALTER TABLE public.branding_settings ADD COLUMN allow_client_theme_toggle BOOLEAN')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='branding_settings'
         AND column_name = (c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END
$$;

-- Seed the singleton row (id=1) if missing
INSERT INTO public.branding_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
-- ===== END FILE: 20251107_create_branding_settings.sql =====


-- ===== BEGIN FILE: 20251106_add_localization_settings.sql =====
-- Create table for per-organization localization settings
CREATE TABLE IF NOT EXISTS public.localization_settings (
  organization_id UUID PRIMARY KEY,
  locale           TEXT        NOT NULL DEFAULT 'en-US',
  timezone         TEXT        NOT NULL DEFAULT 'America/New_York',
  date_format      TEXT        NOT NULL DEFAULT 'yyyy-MM-dd',   -- e.g. 2025-11-06
  time_format      TEXT        NOT NULL DEFAULT 'HH:mm',        -- 24h by default
  number_format    TEXT        NOT NULL DEFAULT '1,234.56',
  first_day_of_week INT        NOT NULL DEFAULT 0,              -- 0=Sunday, 1=Monday
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bump updated_at on any update
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_localization_settings_touch ON public.localization_settings;
CREATE TRIGGER trg_localization_settings_touch
BEFORE UPDATE ON public.localization_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Optional: backfill a row for the default organization if you have one.
INSERT INTO public.localization_settings (organization_id)
SELECT o.id
FROM public.organizations o
LEFT JOIN public.localization_settings ls ON ls.organization_id = o.id
WHERE ls.organization_id IS NULL;
-- ===== END FILE: 20251106_add_localization_settings.sql =====


-- ===== BEGIN FILE: 20251106_add_user_profile_columns.sql =====
-- 20251106_add_user_profile_columns.sql
-- Add user profile columns expected by MeService/UsersService (idempotent)


DO $$
BEGIN
  -- phone
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='phone'
  ) THEN
    ALTER TABLE public.users ADD COLUMN phone text;
  END IF;

  -- timezone
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='timezone'
  ) THEN
    ALTER TABLE public.users ADD COLUMN timezone text;
  END IF;

  -- locale
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='locale'
  ) THEN
    ALTER TABLE public.users ADD COLUMN locale text;
  END IF;

  -- avatar urls
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='avatar_url'
  ) THEN
    ALTER TABLE public.users ADD COLUMN avatar_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='avatar_thumb_url'
  ) THEN
    ALTER TABLE public.users ADD COLUMN avatar_thumb_url text;
  END IF;

  -- address block
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='address1'
  ) THEN
    ALTER TABLE public.users ADD COLUMN address1 text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='address2'
  ) THEN
    ALTER TABLE public.users ADD COLUMN address2 text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='city'
  ) THEN
    ALTER TABLE public.users ADD COLUMN city text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='state'
  ) THEN
    ALTER TABLE public.users ADD COLUMN state text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='postal'
  ) THEN
    ALTER TABLE public.users ADD COLUMN postal text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='country'
  ) THEN
    ALTER TABLE public.users ADD COLUMN country text;
  END IF;
END
$$;


-- Verification (optional)
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='users'
--   AND column_name IN ('phone','timezone','locale','avatar_url','avatar_thumb_url',
--                       'address1','address2','city','state','postal','country')
-- ORDER BY column_name;
-- ===== END FILE: 20251106_add_user_profile_columns.sql =====


-- ===== BEGIN FILE: 20251106_align_agents_uuid_and_localization_id_to_text.sql =====
-- Convert agents.agent_uuid -> TEXT so COALESCE with text works everywhere.
DO $$
DECLARE
  v_exists boolean;
  v_type   text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='agent_uuid'
  ) INTO v_exists;

  IF v_exists THEN
    SELECT data_type
      INTO v_type
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agents' AND column_name='agent_uuid';

    IF v_type <> 'text' THEN
      -- Drop dependent constraints if present
      IF EXISTS (
        SELECT 1
        FROM   pg_constraint c
        JOIN   pg_class     t ON c.conrelid = t.oid
        JOIN   pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
        WHERE  t.relname = 'agents'
          AND  c.conname = 'agents_agent_uuid_key'
      ) THEN
        ALTER TABLE public.agents DROP CONSTRAINT agents_agent_uuid_key;
      END IF;

      ALTER TABLE public.agents
        ALTER COLUMN agent_uuid TYPE TEXT USING agent_uuid::text;

      ALTER TABLE public.agents
        ADD CONSTRAINT agents_agent_uuid_key UNIQUE (agent_uuid);
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;

-- Ensure agents.token is TEXT (if still not), and backfill smartly
DO $$
DECLARE
  v_type text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='agents' AND column_name='token') THEN
    SELECT data_type INTO v_type
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agents' AND column_name='token';
    IF v_type <> 'text' THEN
      ALTER TABLE public.agents
        ALTER COLUMN token TYPE TEXT USING token::text;
    END IF;
  ELSE
    ALTER TABLE public.agents ADD COLUMN token TEXT;
  END IF;

  -- Ensure agent_token exists and is TEXT
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='agent_token'
  ) THEN
    ALTER TABLE public.agents ADD COLUMN agent_token TEXT;
  END IF;

  -- Backfill token with the best available string
  UPDATE public.agents a
     SET token = COALESCE(NULLIF(a.token, ''), NULLIF(a.agent_token, ''), NULLIF(a.agent_uuid, ''))
   WHERE a.token IS NULL OR a.token = '';
END
$$ LANGUAGE plpgsql;

-- Make agents.hostname exist (already done earlier, but keep idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='agents')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='agents' AND column_name='hostname'
     )
  THEN
    ALTER TABLE public.agents ADD COLUMN hostname TEXT;
  END IF;
END
$$ LANGUAGE plpgsql;

-- Backfill agents.hostname once from devices.hostname if blank
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='agents'  AND column_name='hostname')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='agents'  AND column_name='device_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='devices' AND column_name='hostname')
  THEN
    UPDATE public.agents a
       SET hostname = d.hostname
      FROM public.devices d
     WHERE a.device_id = d.id
       AND (a.hostname IS NULL OR a.hostname = '');
  END IF;
END
$$ LANGUAGE plpgsql;

-- For localization_settings: make 'id' a TEXT mirror of organization_id to tolerate 'id' = '1' style lookups.
DO $$
DECLARE
  v_exists boolean;
  v_type   text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) INTO v_exists;

  IF v_exists THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='id'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN id TEXT;
      UPDATE public.localization_settings SET id = organization_id::text WHERE id IS NULL;
    ELSE
      SELECT data_type INTO v_type
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name='localization_settings' AND column_name='id';
      IF v_type <> 'text' THEN
        ALTER TABLE public.localization_settings
          ALTER COLUMN id TYPE TEXT USING id::text;
      END IF;
      UPDATE public.localization_settings SET id = organization_id::text WHERE id IS NULL OR id = '';
    END IF;

    -- Keep it unique and non-null (separate from PK on organization_id)
    DO $inner$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='localization_settings' AND indexname='uq_localization_settings_id_text'
      ) THEN
        CREATE UNIQUE INDEX uq_localization_settings_id_text ON public.localization_settings(id);
      END IF;
    END
    $inner$;
  END IF;
END
$$ LANGUAGE plpgsql;
-- ===== END FILE: 20251106_align_agents_uuid_and_localization_id_to_text.sql =====


-- ===== BEGIN FILE: 20251106_fix_agents_token_types_and_currency.sql =====
-- 1) Normalize agent token columns so COALESCE(...) never mixes uuid/text.

DO $$
DECLARE
  v_token_type TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='agents'
  ) THEN
    -- Ensure agent_token TEXT exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='agents' AND column_name='agent_token'
    ) THEN
      ALTER TABLE public.agents ADD COLUMN agent_token TEXT;
    END IF;

    -- Ensure token exists and is TEXT
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='agents' AND column_name='token'
    ) THEN
      ALTER TABLE public.agents ADD COLUMN token TEXT;
    ELSE
      SELECT data_type INTO v_token_type
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name='agents' AND column_name='token';
      IF v_token_type IS NOT NULL AND v_token_type <> 'text' THEN
        ALTER TABLE public.agents
          ALTER COLUMN token TYPE TEXT USING token::text;
      END IF;
    END IF;

    -- Backfill token with best available value: token -> agent_token -> agent_uuid::text
    UPDATE public.agents a
       SET token = COALESCE(
                    NULLIF(a.token, ''),
                    NULLIF(a.agent_token, ''),
                    a.agent_uuid::text
                  )
     WHERE a.token IS NULL OR a.token = '';
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2) Add localization_settings.currency and backfill.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='currency'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN currency TEXT;
    END IF;

    UPDATE public.localization_settings
       SET currency = COALESCE(NULLIF(currency, ''), 'USD');

    ALTER TABLE public.localization_settings
      ALTER COLUMN currency SET NOT NULL;
  END IF;
END
$$ LANGUAGE plpgsql;
-- ===== END FILE: 20251106_fix_agents_token_types_and_currency.sql =====


-- ===== BEGIN FILE: 20251106_backfill_agents_hostname_and_sync_localization.sql =====
-- Backfill agents.hostname from devices.hostname (one-time)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='agents'  AND column_name='hostname')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='agents'  AND column_name='device_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='devices' AND column_name='hostname')
  THEN
    UPDATE public.agents a
       SET hostname = d.hostname
      FROM public.devices d
     WHERE a.device_id = d.id
       AND (a.hostname IS NULL OR a.hostname = '');
  END IF;
END
$$ LANGUAGE plpgsql;

-- Ensure localization_settings rows exist and align with organizations.time_zone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) THEN
    INSERT INTO public.localization_settings (organization_id, locale, language, timezone, time_zone)
    SELECT o.id,
           'en-US'::text,
           'en-US'::text,
           COALESCE(o.time_zone, 'UTC'),
           COALESCE(o.time_zone, 'UTC')
      FROM public.organizations o
 LEFT JOIN public.localization_settings ls ON ls.organization_id = o.id
     WHERE ls.organization_id IS NULL;

    UPDATE public.localization_settings ls
       SET timezone  = COALESCE(NULLIF(ls.timezone,  ''), o.time_zone, 'UTC'),
           time_zone = COALESCE(NULLIF(ls.time_zone, ''), o.time_zone, 'UTC'),
           language  = COALESCE(NULLIF(ls.language,  ''), 'en-US')
      FROM public.organizations o
     WHERE o.id = ls.organization_id;
  END IF;
END
$$ LANGUAGE plpgsql;
-- ===== END FILE: 20251106_backfill_agents_hostname_and_sync_localization.sql =====


-- ===== BEGIN FILE: 20251106_fix_localization_columns_and_sync.sql =====
-- Ensure required columns exist on localization_settings, then sync rows.

-- 1) Add missing columns (idempotent) and backfill
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) THEN
    -- language column
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='language'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN language TEXT;
    END IF;

    -- time_zone column
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='time_zone'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN time_zone TEXT;
    END IF;

    -- Backfill language from locale if needed
    UPDATE public.localization_settings
       SET language = COALESCE(language, locale, 'en-US');

    -- Backfill time_zone
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='timezone'
    ) THEN
      UPDATE public.localization_settings
         SET time_zone = COALESCE(time_zone, timezone, 'UTC');
    ELSE
      UPDATE public.localization_settings ls
         SET time_zone = COALESCE(ls.time_zone, o.time_zone, 'UTC')
        FROM public.organizations o
       WHERE o.id = ls.organization_id;
    END IF;

    -- Enforce NOT NULL after backfill
    ALTER TABLE public.localization_settings
      ALTER COLUMN language  SET NOT NULL,
      ALTER COLUMN time_zone SET NOT NULL;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2) Insert missing rows for organizations and align existing ones
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) THEN
    INSERT INTO public.localization_settings (organization_id, locale, language, timezone, time_zone)
    SELECT o.id,
           'en-US'::text,
           'en-US'::text,
           COALESCE(o.time_zone, 'UTC'),
           COALESCE(o.time_zone, 'UTC')
      FROM public.organizations o
 LEFT JOIN public.localization_settings ls ON ls.organization_id = o.id
     WHERE ls.organization_id IS NULL;

    UPDATE public.localization_settings ls
       SET locale    = COALESCE(NULLIF(ls.locale,    ''), 'en-US'),
           language  = COALESCE(NULLIF(ls.language,  ''), 'en-US'),
           timezone  = COALESCE(NULLIF(ls.timezone,  ''), o.time_zone, 'UTC'),
           time_zone = COALESCE(NULLIF(ls.time_zone, ''), o.time_zone, 'UTC')
      FROM public.organizations o
     WHERE o.id = ls.organization_id;
  END IF;
END
$$ LANGUAGE plpgsql;
-- ===== END FILE: 20251106_fix_localization_columns_and_sync.sql =====


-- ===== BEGIN FILE: 20251106_fix_uuid_text_coalesce_and_localization_id.sql =====
-- 1) Allow implicit cast uuid -> text (safe for this app)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_cast c
    JOIN pg_type s ON c.castsource = s.oid
    JOIN pg_type t ON c.casttarget = t.oid
    WHERE s.typname = 'uuid' AND t.typname = 'text' AND c.castcontext = 'i'
  ) THEN
    CREATE CAST (uuid AS text) WITH INOUT AS IMPLICIT;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2) Ensure localization_settings.id mirrors organization_id and stays unique
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='id'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN id UUID;
      UPDATE public.localization_settings SET id = organization_id WHERE id IS NULL;
      ALTER TABLE public.localization_settings
        ALTER COLUMN id SET NOT NULL;
      DO $inner$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname='public' AND tablename='localization_settings' AND indexname='uq_localization_settings_id'
        ) THEN
          CREATE UNIQUE INDEX uq_localization_settings_id ON public.localization_settings(id);
        END IF;
      END
      $inner$;
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;
-- ===== END FILE: 20251106_fix_uuid_text_coalesce_and_localization_id.sql =====


-- ===== BEGIN FILE: 20251106_hotfix_agents_hostname_and_localization_language.sql =====
-- Hotfix: add columns expected by the app, without changing application code.

ALTER TABLE IF EXISTS public.localization_settings
    ADD COLUMN IF NOT EXISTS language TEXT;

UPDATE public.localization_settings
SET language = COALESCE(language, locale, 'en-US');

ALTER TABLE IF EXISTS public.localization_settings
    ALTER COLUMN language SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agents'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'hostname'
    ) THEN
      ALTER TABLE public.agents ADD COLUMN hostname TEXT;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'devices'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'hostname'
    ) THEN
      ALTER TABLE public.devices ADD COLUMN hostname TEXT;
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;
-- ===== END FILE: 20251106_hotfix_agents_hostname_and_localization_language.sql =====


-- ===== BEGIN FILE: 20251107_add_admin_access_permission.sql =====
-- Adds the 'admin.access' permission used to gate access to the /administration area.

CREATE UNIQUE INDEX IF NOT EXISTS permissions_permission_key_uidx
  ON permissions(permission_key);

INSERT INTO permissions (
    permission_key,
    label,
    group_key,
    group_label,
    description,
    created_at,
    updated_at
)
VALUES (
    'admin.access',
    'Access Administration',
    'admin',
    'Administration',
    'Allows viewing and using the /administration area.',
    NOW(),
    NOW()
)
ON CONFLICT (permission_key) DO UPDATE
SET
    label       = EXCLUDED.label,
    group_key   = EXCLUDED.group_key,
    group_label = EXCLUDED.group_label,
    description = EXCLUDED.description,
    updated_at  = NOW();

-- ===== END FILE: 20251107_add_admin_access_permission.sql =====

COMMIT;
