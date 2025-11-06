-- RemoteIQ database redesign schema
-- This script defines the normalized schema described in docs/database_redesign_plan.md
-- It can be applied to a clean database or used as a reference for building
-- incremental migrations from the legacy schema found in remoteiq_full.sql.

BEGIN;

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

COMMIT;
