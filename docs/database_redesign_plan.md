# RemoteIQ Database Redesign Plan

> **Implementation note:** The normalized target schema is captured in `database/migrations/20240101_redesign.sql`. Use that script as the authoritative definition when building incremental migrations.

## 1. Current schema issues by module

### Authentication & users
- `users` stores both a free-form `role` text column and lacks a foreign key to `roles`, while `roles_with_meta` still joins by `users.role`, leading to duplicate sources of truth for authorization.
- `role_meta` keeps role descriptions and permissions as a `text[]`, duplicating the normalized `role_permissions` table and requiring triggers to maintain timestamps.
- `sessions` mixes `last_seen` and `last_seen_at` columns, and `trusted_devices`/`personal_tokens` have no explicit primary keys beyond UUID defaults and lack audit columns beyond creation, making lifecycle tracking uneven.
- Multiple timestamp triggers exist for `users` and `role_meta`, and two nearly identical triggers (`trg_users_updated_at` and `users_set_updated_at`) fire on the same table, complicating maintenance.

### Roles & permissions
- `role_permissions` has no primary key or timestamps, so duplicates cannot be prevented or audited.
- Permission metadata (`key`, `label`, `group_key`, `group_label`) is static but stored solely in `permissions`, making seed management ad hoc without effective grouping tables.

### Devices, agents & software
- `agent_jobs` uses a legacy integer `agent_id` whereas `agents.id` is `bigint`, and there is no foreign key between them. `jobs` introduces a second job system keyed by UUID, duplicating concepts and leaving automation split between tables.
- `agents` contains both `device_id` text and `agent_uuid` with redundant unique indexes (`agents_device_id_key` and `agents_device_id_uk`), while `devices` keeps its own UUID primary key and another `agent_uuid`, all without enforced relationships.
- `agent_software` references agents via an integer foreign key and stores business attributes like `install_date` as text, making querying and joins harder.

### Monitoring checks
- `check_assignments` stores `check_type`/`check_name` strings instead of referencing `checks`, and both assignments and runs lack foreign keys to `devices`, leaving monitoring relationships unenforced.
- Status/severity fields are text without enumerations, leading to inconsistent values.

### Jobs & automation
- `job_results` has no primary key or timestamps, and `jobs` stores agent identity both as `agent_id` and `agent_uuid`, reflecting the migration gap between integer and UUID identifiers.

### Backups
- `backups_config` is a singleton table keyed by the literal `'singleton'`, mixing configuration for all tenants. Operational tables (`backup_jobs`, `backup_restores`, manifests, logs) lack references to devices/agents and often omit `updated_at` or status enums.
- There is no modeling of backup policies/destinations separate from executions.

### Tickets & support
- `tickets` keeps both `assignee_id` and `assignee_user_id`, `customer_id` and `customer_uuid`, and references `client`, `site`, and `device_id` as free-form text, preventing relational integrity.
- `support_legal`, `support_legal_settings`, `branding_settings`, and `localization_settings` all act as singleton settings tables without consistent keys or timestamps.

### Email, SMTP/IMAP, branding
- Channel tables use inconsistent types: `email_settings.purpose` relies on an enum, while `imap_state` and `email_inbound_events` store `purpose` as free text, and `imap_ingested` duplicates message metadata without any linkage to tickets or users.
- DKIM keys mix integer identity with global settings (`dkim_settings`) instead of modeling domains separately.

### Legacy/utility objects
- The `select_all_tables` helper function and duplicated timestamp triggers are operational leftovers with no application purpose.

## 2. Target schema overview

### Core platform & tenancy
- **organizations**: `id uuid PK`, `name`, contact info, `created_at`, `updated_at`.
- **organization_settings**: 1:1 to organizations, storing branding, localization, legal/support, notification defaults (replacing `branding_settings`, `localization_settings`, `support_legal*`, `company_profile`). Include JSONB columns for flexible settings with last-modified timestamps and maintain change history via `organization_setting_audits`.

### Authentication & authorization
- **users**: `id uuid PK`, `organization_id FK`, `email UNIQUE`, `password_hash`, profile fields, `status`, `last_seen_at`, `created_at`, `updated_at`.
- **user_security**: `user_id PK/FK`, `two_factor_enabled`, `totp_secret`, recovery codes, password metadata.
- **roles**: `id uuid PK`, `organization_id FK (nullable for system roles)`, `name UNIQUE per org`, `description`, timestamps.
- **permissions**: stable catalog table keyed by `permission_key`, with metadata columns for grouping and display.
- **role_permissions**: PK on `(role_id, permission_key)`, plus `granted_at`, `granted_by`.
- **user_roles**: PK `(user_id, role_id)` to replace `users.role` text.
- **sessions**, **trusted_devices**, **personal_access_tokens**, **login_challenges**: ensure consistent naming (`created_at`, `last_seen_at`, `revoked_at`), enforce FK to `users`, add indexes on `user_id` and tokens.

### Clients, sites, devices & agents
- **clients**: `id uuid PK`, `organization_id FK`, names, contact info, SLA metadata.
- **sites**: `id uuid PK`, `client_id FK`, address data.
- **devices**: `id uuid PK`, `site_id FK`, `hostname`, `os`, `arch`, `status` enum, `primary_user`, `last_seen_at`, `created_at`, `updated_at`.
- **agents**: `id uuid PK`, `device_id FK UNIQUE`, `agent_uuid UNIQUE`, versioning, connectivity details, `facts` JSONB, `created_at`, `updated_at`.
- **agent_software**: PK `id uuid`, FK `agent_id`, normalized columns (`install_date` as timestamp), indexes on `name`, `publisher`.
- **agent_tasks**: unify legacy `agent_jobs`/`jobs` into a single table with PK `id uuid`, FK `agent_id`, `type` enum, JSONB payload, status enum, scheduling timestamps; accompany with **agent_task_runs** for retries/executions and **agent_task_results**.

### Monitoring checks
- **checks**: PK `id uuid`, `organization_id`, `name`, `type` enum, `category`, configuration JSONB, `created_by`, timestamps (retain interval/timeouts).
- **check_profiles**: optional grouping of checks for assignment.
- **check_assignments**: PK `id uuid`, FKs to `check_id`, `target_type` enum (`DEVICE`,`SITE`,`CLIENT`,`GLOBAL`), `target_id`, `created_by`, timestamps.
- **check_runs**: PK `id uuid`, FK `assignment_id`, `started_at`, `finished_at`, status and severity enums, metrics JSONB, outputs, indexes on `(assignment_id, started_at)`.

### Jobs & automation
- **automations** (scripts/policies) referenced by tasks.
- **automation_runs** to store execution results, referencing `agent_task_runs`.

### Backups
- **backup_policies**: PK `id uuid`, ties to `site` or `device`, schedule enum/cron, retention policy, encryption flag.
- **backup_destinations**: `id uuid`, provider type, credentials (encrypted), FK to `organization`.
- **backup_jobs**: PK `id uuid`, FK `policy_id`, `status` enum, bytes, durations, timestamps, `agent_id`.
- **backup_job_logs**, **backup_job_artifacts**, **backup_restores**: reference `backup_job_id`, include audit fields.
- Legacy `backups_config` data can remain available via a compatibility view if desired, but the NestJS services now persist configuration through `backup_policies`/`backup_destinations`, so new code should rely on the organization-scoped tables directly.

### Storage connectors
- **storage_connections**: `id uuid`, `organization_id` FK, `kind`, sanitized `config` JSONB, secret material JSONB, metadata/capabilities/health, timestamps. This backs both the Storage and Backups admin tabs while providing a landing zone for future per-organization destinations.

### Tickets & support
- **contacts** table storing customer/end-user identities per organization and linked to tickets.
- **tickets**: PK `id uuid`, `organization_id`, `number` unique sequence per org, `requester_contact_id`, `assignee_user_id`, `status` enum, `priority` enum, `device_id` FK, `created_at`, `updated_at`, `closed_at`.
- **ticket_updates**: comments/status changes referencing `tickets` and `users`.
- **ticket_tags**, **ticket_attachments** for extensibility.

### Email, SMTP/IMAP & communications
- **email_channels**: PK `id uuid`, `organization_id`, `purpose` enum, SMTP/IMAP settings, `is_inbound_enabled`, `is_outbound_enabled`, timestamps.
- **email_messages**: store inbound/outbound metadata linked to tickets or notifications.
- **email_ingest_state**: FK `channel_id`, `last_uid`, timestamps.
- **dkim_domains**/**dkim_keys**: domain-scoped keys referencing `email_channels`.

### Branding, localization & settings
- Move singleton tables into per-organization settings with consistent `settings` tables plus history tables if required. Provide JSON schema for UI-extensible fields.

### Cross-cutting conventions
- All tables adopt `snake_case` names, `created_at`/`updated_at` (and optional `deleted_at`) with default `now()` and a single generic `set_updated_at` trigger used only where needed.
- Index naming standard: `idx_<table>_<column>` or `uq_<table>_<column>` for uniqueness.
- Use domains/enums for statuses (`user_status`, `ticket_status`, `backup_status`, etc.) to enforce valid values.

### Seed data
- Seed global permissions grouped by module (e.g., `users.manage`, `agents.view`, `checks.run`).
- Seed system roles (`Owner`, `Administrator`, `Technician`, `ReadOnly`) with curated permission bundles.
- Seed default organization settings (branding colors, localization defaults, support contact) using the new `organization_settings`.
- Provide default monitoring checks and backup policies as templates.

## 3. Migration strategy

1. **Preparation**
   - Create new enums/domains for statuses/severities.
   - Define new tables alongside the existing schema using transactional migrations (`CREATE TABLE …`). Include PKs, FKs, indexes.
   - Introduce new `organization` concept; if single-tenant initially, create one organization and map all existing rows to it.

2. **Backfill reference data**
   - Populate `organizations`, `organization_settings`, and `email_channels` from existing singleton tables (`branding_settings`, `support_legal*`, `email_settings`, `dkim_*`). Record mapping tables (e.g., `legacy_settings_map`) for rollback.

3. **Users & roles**
   - Insert into `roles` with organization scope, migrating current rows; populate `permissions` catalog (seed script).
   - Migrate `role_meta.permissions` arrays into `role_permissions` by splitting and mapping text keys; drop duplicates.
   - Create `user_roles` from `users.role` by joining on case-insensitive name; store `assigned_at`.
   - Move 2FA columns into `user_security`, preserving values.
   - Update application to read roles via join while keeping legacy columns until validated.

4. **Clients/sites/devices/agents**
   - Derive distinct `client` and `site` values from `agents`, `devices`, `tickets`; insert into new tables with generated UUIDs.
   - Add `client_id`/`site_id` columns to `devices`, `agents`, `tickets` (nullable), populate using mapping tables, then enforce FKs.
   - Convert `agents.id` to UUID by adding a new column `id_uuid` or new table; update dependent tables (`jobs`, `agent_software`). Once backfilled, drop integer PK and rename.

5. **Monitoring**
   - Normalize `check_assignments` by adding `check_id` (FK) and `target_id` columns; backfill by matching on `(check_type, check_name)` to `checks`. After verification, remove redundant text columns.
   - Backfill `check_runs.assignment_id` with new FK values; enforce constraints.

6. **Jobs & automation**
   - Merge `agent_jobs` into `jobs`: add legacy identifier columns to `jobs`, backfill, then deprecate `agent_jobs`. Ensure `job_results` references new `job_run_id`.

7. **Backups**
   - Create `backup_policies`, `backup_destinations`, `backup_targets`; populate from `backups_config.targets/destination`. Update `backup_jobs` to FK to `policy_id` and `agent_id`.
   - Backfill logs/manifests to reference new job IDs; drop singleton columns.

8. **Tickets & support**
   - Introduce `requester_contact` table. Populate from `tickets` `requester_name/email`.
   - Add `device_id` FK referencing normalized devices.
   - Replace `assignee_id` with `assignee_user_id`; migrate values and drop redundant columns.
   - Move support/legal/branding/localization rows into `organization_settings` and `support_channels`.

9. **Email & messaging**
   - Create `email_channels` and migrate `email_settings` rows (one per purpose) into them, converting enum/text mismatches.
   - Backfill `email_ingest_state` from `imap_state` and message history from `imap_ingested`/`email_inbound_events`.

10. **Cleanup**
    - Update triggers: keep a single reusable `set_updated_at` trigger function and attach where necessary; drop duplicates.
    - Drop legacy tables/views/functions once new schema is verified (`agent_jobs`, `role_meta`, `roles_with_meta`, `select_all_tables`, singleton setting tables).
    - Rename remaining columns to snake_case (e.g., `last_seen` → `last_seen_at`) via `ALTER TABLE … RENAME COLUMN`.
    - Update sequences/indexes to follow naming conventions.

11. **Data validation**
    - Run consistency checks comparing counts and sums between old and new tables; maintain migration logs.
    - After validation, remove deprecated columns and drop staging mapping tables.

12. **Seeding & permissions**
    - Execute seed migrations for permissions, roles, and default settings. Ensure seeds are idempotent.

13. **Finalization**
    - Enforce non-null constraints and foreign keys only after data backfill and validation.
    - Create final views or materialized views needed by reporting.

## 4. Application updates (NestJS & Next.js)

- **Data access layer**
  - Refactor SQL queries to use new table/column names (`user_roles`, `organization_settings`, etc.) and adjust joins; update DTOs/interfaces to match.
  - Centralize organization scoping in repositories (include `organization_id` filters in all queries).

- **Authentication/authorization**
  - Replace usages of `users.role` with joins through `user_roles`/`roles` and permission checks via `role_permissions`. Update guards/interceptors to load permissions by key.
  - Update 2FA flows to read/write from `user_security`.

- **Devices/agents**
  - Adjust agent registration endpoints to supply `device_id` UUID and organization context; update queries for tasks/jobs to reference new `agent_tasks` tables.

- **Monitoring**
  - Update check assignment APIs to supply `check_id` and `target_type/id`; adjust UI components to display normalized relationships.

- **Backups/tickets**
  - Modify backup scheduling/job tracking endpoints to reference `backup_policies` and `backup_jobs`.
  - Update ticket creation/editing flows to select clients/sites/devices via FK lookups and to handle new contact tables.

- **Settings/branding**
  - Refactor settings service to read from `organization_settings` JSON blobs; update caching/invalidation logic.
  - Adjust admin UI forms to write to the new consolidated settings API.

- **Email integrations**
  - Update SMTP/IMAP configuration forms and background workers to use `email_channels`, ensuring ingestion jobs filter by `channel_id`.
  - Update DKIM management to reference `dkim_domains` and keys.

- **Seeds & migrations**
  - Provide new migration scripts (likely using custom SQL runners) to create seed data and remove legacy structures.
  - Update test fixtures and factories to align with the new normalized schema.

