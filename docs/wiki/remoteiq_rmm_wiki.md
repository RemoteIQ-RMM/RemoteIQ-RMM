# RemoteIQ RMM Platform Wiki

> **Audience:** Operators and engineers maintaining the RemoteIQ RMM platform after the database redesign.
>
> **Scope:** End-to-end reference for schema objects, backend services, frontend flows, deployment steps, and troubleshooting tips required to run the normalized platform.

## Table of Contents
- [System Overview](#system-overview)
- [Database Schema Reference](#database-schema-reference)
  - [Core Platform & Tenancy](#core-platform--tenancy)
  - [Authentication & Authorization](#authentication--authorization)
  - [Storage Connectors](#storage-connectors)
  - [Backups Domain](#backups-domain)
  - [Monitoring & Automations](#monitoring--automations)
  - [Tickets, Support, and Communications](#tickets-support-and-communications)
- [Backend Services](#backend-services)
  - [Organization Context Resolution](#organization-context-resolution)
  - [Storage API](#storage-api)
  - [Backups API & Worker](#backups-api--worker)
  - [Authentication Guardrail Updates](#authentication-guardrail-updates)
- [Frontend Integrations](#frontend-integrations)
  - [Administration Users Tab](#administration-users-tab)
  - [Shared Administration Types](#shared-administration-types)
- [Operational Playbook](#operational-playbook)
  - [Applying the Redesign Migration](#applying-the-redesign-migration)
  - [Seeding and Default Data](#seeding-and-default-data)
  - [Deployment Checklist](#deployment-checklist)
- [Troubleshooting](#troubleshooting)
  - [Schema & Migration Issues](#schema--migration-issues)
  - [Storage Connector Issues](#storage-connector-issues)
  - [Backups Workflow Issues](#backups-workflow-issues)
  - [Frontend Role Metadata Issues](#frontend-role-metadata-issues)

---

## System Overview

RemoteIQ now operates on a fully normalized PostgreSQL schema with consistent naming, explicit foreign keys, and organization-scoped data. The redesign consolidates previously duplicated tables (such as `backups_config` and `storage_connections` variants) into a single authoritative schema that is mirrored by updated NestJS services and React components.【F:docs/database_redesign_plan.md†L1-L112】

Key guiding principles:

1. **Single source of truth:** Each logical concept—organizations, roles, storage connectors, backup policies—has a dedicated table with primary and foreign keys.【F:docs/database_redesign_plan.md†L44-L112】
2. **Organization scoping everywhere:** Every user-facing table references `organizations.id` so multi-tenant scenarios remain isolated.【F:database/migrations/20240101_redesign.sql†L39-L92】
3. **Consistent lifecycle metadata:** Every table captures `created_at` and `updated_at`, maintained by a shared `set_updated_at` trigger, so auditing is uniform.【F:database/migrations/20240101_redesign.sql†L27-L96】
4. **Service alignment:** NestJS services now hydrate and persist data using the normalized schema; the frontend consumes enriched DTOs without losing backward compatibility.【F:remoteiq-minimal-e2e/backend/src/storage/storage.controller.ts†L15-L62】【F:remoteiq-minimal-e2e/backend/src/backups/backups.service.ts†L15-L334】【F:remoteiq-frontend/app/administration/tabs/UsersTab.tsx†L88-L158】

---

## Database Schema Reference

### Core Platform & Tenancy

* `organizations`: canonical tenant registry with unique slugs and time zone metadata.【F:database/migrations/20240101_redesign.sql†L39-L46】
* `organization_settings`: JSONB-backed branding, localization, support, and notification settings with automatic timestamp updates via `trg_organization_settings_updated`.【F:database/migrations/20240101_redesign.sql†L48-L60】
* `support_channels`: channel catalog keyed by organization for phone, chat, or escalation metadata.【F:database/migrations/20240101_redesign.sql†L62-L75】

### Authentication & Authorization

* `users`: email-unique per organization, `user_status` enum, and lifecycle timestamps.【F:database/migrations/20240101_redesign.sql†L100-L116】
* `user_security`: centralizes 2FA secrets, recovery codes, and password change tracking; inherits the shared trigger for `updated_at`.【F:database/migrations/20240101_redesign.sql†L118-L130】
* `roles` & `permissions`: normalized RBAC foundation with scope-aware uniqueness and descriptive metadata for UI display.【F:database/migrations/20240101_redesign.sql†L132-L156】
* `role_permissions` & `user_roles`: enforce many-to-many relationships with composite primary keys, allowing deterministic permission checks in the updated guards.【F:database/migrations/20240101_redesign.sql†L161-L175】
* Session lifecycle tables (`sessions`, `trusted_devices`, `personal_access_tokens`) unify audit fields for login tracking and device trust states.【F:database/migrations/20240101_redesign.sql†L177-L210】

### Storage Connectors

* `storage_connections`: one table drives both the Storage admin tab and backup destinations. Each row stores sanitized config JSON, secret material, capability metadata, and health signals under a consistent trigger.【F:database/migrations/20240101_redesign.sql†L77-L96】
* Allowed connector kinds are constrained to `s3`, `nextcloud`, `gdrive`, and `sftp`, aligning with validation logic in the service layer.【F:database/migrations/20240101_redesign.sql†L79-L84】【F:remoteiq-minimal-e2e/backend/src/storage/storage-connections.service.ts†L34-L57】

### Backups Domain

* `backup_destinations`: per-organization storage endpoints that reference `storage_connections` through upsert logic in the service layer (defined later in the migration file).【F:remoteiq-minimal-e2e/backend/src/backups/backups.service.ts†L220-L262】
* `backup_policies`: schedules, retention rules, and option JSON for each organization’s default and advanced policies, now referencing destinations and target scopes instead of a singleton row.【F:remoteiq-minimal-e2e/backend/src/backups/backups.service.ts†L220-L283】
* `backup_jobs`, `backup_job_logs`, `backup_job_artifacts`, `backup_restores`: detailed execution history, logs, and artifact metadata managed by the worker for auditing and download flows (see Backups API & Worker section).【F:remoteiq-minimal-e2e/backend/src/backups/worker.service.ts†L51-L199】

### Monitoring & Automations

* Enums (`check_type`, `agent_task_type`, `agent_task_status`) standardize classification of monitoring checks and automation tasks, ensuring consistent downstream filtering and reporting.【F:database/migrations/20240101_redesign.sql†L16-L24】
* Agent task tables (defined later in the migration) consolidate prior `agent_jobs` and `jobs` tables into a single execution model with retry-aware run tables (see migration file for full definitions).【F:docs/database_redesign_plan.md†L65-L75】

### Tickets, Support, and Communications

* Ticketing tables adopt normalized contacts, device references, and status enums for robust SLA tracking (full definitions available in the migration script’s later sections).【F:docs/database_redesign_plan.md†L77-L112】
* Communications leverage the `email_channel_purpose` enum to align inbound/outbound pipelines with the redesigned email channel tables.【F:database/migrations/20240101_redesign.sql†L21-L25】【F:docs/database_redesign_plan.md†L97-L101】

---

## Backend Services

### Organization Context Resolution

The `OrganizationContextService` encapsulates discovery (or creation) of the default organization slug and ensures associated settings rows exist. It caches the organization ID and seeds `organization_settings` on first access, so every downstream service can safely call `getDefaultOrganizationId()` without duplicating bootstrap logic.【F:remoteiq-minimal-e2e/backend/src/storage/organization-context.service.ts†L1-L60】

### Storage API

* `StorageController` exposes REST endpoints for listing, creating, updating, deleting, testing, and browsing storage connectors under `/api/admin/storage`, all protected by the RBAC permission `backups.manage`.【F:remoteiq-minimal-e2e/backend/src/storage/storage.controller.ts†L15-L62】
* `StorageConnectionsService` enforces connector kind validation, sanitizes configuration defaults (for S3, Nextcloud, SFTP), partitions secrets from non-secret configuration, and returns DTOs with capability and health metadata for the frontend.【F:remoteiq-minimal-e2e/backend/src/storage/storage-connections.service.ts†L21-L158】
* Secret rotation is handled by `partitionSecrets`, which extracts credential fields (e.g., `accessKeyId`, `password`, `privateKeyPem`) from incoming payloads before persisting sanitized config JSON to the database.【F:remoteiq-minimal-e2e/backend/src/storage/storage-connections.service.ts†L159-L215】
* Dependency introspection (`getDependents`) prevents deletion of storage connectors that are still referenced by backup policies, while `test` and `browseNextcloud` provide smoke tests for connector health and path exploration (see service file for detailed implementations).【F:remoteiq-minimal-e2e/backend/src/storage/storage-connections.service.ts†L216-L386】
* `StorageModule` bundles the controller, service, shared PostgreSQL pool, permissions guard, and organization context service so other NestJS modules can import a single module for storage operations.【F:remoteiq-minimal-e2e/backend/src/storage/storage.module.ts†L3-L24】

### Backups API & Worker

* `BackupsService` now persists configuration through `backup_destinations` and `backup_policies`, mapping UI DTOs (`BackupConfigDto`) into normalized records while retaining compatibility defaults for targets, schedule, and encryption settings.【F:remoteiq-minimal-e2e/backend/src/backups/backups.service.ts†L15-L334】
* `saveConfig` validates destination payloads (including path safety checks for local and Nextcloud paths, UUID enforcement for connector references) before calling `ensurePolicyAndDestination`, which wraps the upsert logic for destinations and policies.【F:remoteiq-minimal-e2e/backend/src/backups/backups.service.ts†L334-L375】
* History endpoints filter by policy, status, search term, and date range using cursor-based pagination so the UI can stream job lists reliably.【F:remoteiq-minimal-e2e/backend/src/backups/backups.service.ts†L376-L399】
* `WorkerService` orchestrates actual backup execution: it claims pending jobs, exports configured targets to NDJSON files, tars the results, and either writes them to a local path or uploads to S3 using secrets fetched from `storage_connections`. Logs are appended to `backup_job_logs`, and upload artifacts capture metadata for subsequent download or restore flows.【F:remoteiq-minimal-e2e/backend/src/backups/worker.service.ts†L1-L199】
* The worker leverages helper functions (`ensureDir`, `s3PutObject`, `s3Head`) and posts notifications via `NotifierService`, ensuring parity between scheduled jobs and manual “run now” actions (see worker file for additional branches such as cancellation handling and manifest persistence beyond the first 200 lines).【F:remoteiq-minimal-e2e/backend/src/backups/worker.service.ts†L1-L199】

### Authentication Guardrail Updates

The redesigned guards and middleware load permissions via `user_roles` → `role_permissions`, ensuring the Storage and Backups controllers honor RBAC. These guards live alongside the storage module and should be imported anywhere permissioned endpoints are added (see `PermissionsGuard` usage in the controller).【F:remoteiq-minimal-e2e/backend/src/storage/storage.controller.ts†L12-L62】

---

## Frontend Integrations

### Administration Users Tab

* The Users tab normalizes role metadata from the backend, exposing helper functions (`normalizeRoleSummaries`, `getPrimaryRoleId`, `updateUserRoleMetadata`) that gracefully fall back to the legacy `user.role` string while adopting the new `roleId`/`roles[]` fields returned by the API.【F:remoteiq-frontend/app/administration/tabs/UsersTab.tsx†L88-L158】
* Sorting and filtering functions (`userHasRoleFilter`, `resolveRoleSelection`) accept either UUIDs or display names, enabling a smooth transition from string-based roles to ID-based selection in dropdowns and CSV exports.【F:remoteiq-frontend/app/administration/tabs/UsersTab.tsx†L115-L200】

### Shared Administration Types

* `User` DTOs now include optional `roleId` and `roles[]` fields so downstream UI and API clients can adopt multi-role displays without breaking existing code. The optional fields are typed alongside legacy properties for progressive enhancement.【F:remoteiq-frontend/app/administration/types.ts†L7-L33】
* `Role` definitions include `rawPermissions` so the admin UI can surface the new permission catalog once the backend seeds are synchronized with the redesigned schema.【F:remoteiq-frontend/app/administration/types.ts†L36-L52】

---

## Operational Playbook

### Applying the Redesign Migration

1. **Snapshot the existing database** (logical and physical backups) before altering production tables.
2. **Apply `database/migrations/20240101_redesign.sql`** to a staging database. The script creates extensions, enums, triggers, and all normalized tables required by the updated services.【F:database/migrations/20240101_redesign.sql†L1-L210】
3. **Iteratively backfill data** using the migration strategy laid out in `docs/database_redesign_plan.md`—introducing organizations, migrating roles, and converting backups configuration before dropping legacy tables.【F:docs/database_redesign_plan.md†L115-L172】
4. **Run application smoke tests** against staging (see Troubleshooting) to confirm controllers and workers operate correctly before promoting the migration to production.

### Seeding and Default Data

* Seed global roles, permissions, and organization records using idempotent scripts aligned with the `roles`, `permissions`, and `organization_settings` tables. The redesign plan lists required seed sets for Owner/Admin roles and default settings.【F:docs/database_redesign_plan.md†L107-L112】
* When the application first starts, `OrganizationContextService` ensures an organization exists based on `DEFAULT_ORGANIZATION_SLUG`/`_NAME` environment variables, inserting default settings if necessary.【F:remoteiq-minimal-e2e/backend/src/storage/organization-context.service.ts†L19-L59】

### Deployment Checklist

1. Apply schema migration scripts in a controlled environment.
2. Run backend unit/integration tests (or at minimum TypeScript builds) to catch missing dependencies.
3. Deploy the NestJS backend and ensure environment variables for Postgres connectivity, default organization, and storage credentials are configured.
4. Deploy the Next.js frontend; verify that the Users, Storage, and Backups tabs load without API errors.
5. Monitor logs for RBAC denials—controllers now require `backups.manage` permission for storage and backups endpoints, so ensure admin roles include the new permission key.

---

## Troubleshooting

### Schema & Migration Issues

| Symptom | Likely Cause | Resolution |
| --- | --- | --- |
| `organizations` table missing when services boot | Migration not applied or ran on wrong database | Re-run `20240101_redesign.sql` and confirm the connection string points to the correct database before starting the NestJS app.【F:database/migrations/20240101_redesign.sql†L39-L96】【F:remoteiq-minimal-e2e/backend/src/storage/organization-context.service.ts†L19-L59】 |
| `permission denied for relation storage_connections` | RBAC role lacks permission or table absent | Ensure migration created `storage_connections` and that the connecting database role owns it; update grants accordingly.|
| Duplicate slug errors during bootstrap | `DEFAULT_ORGANIZATION_SLUG` collides with existing slug | Either change the environment variable or allow the upsert in `OrganizationContextService` to update the display name (no action needed if slug intentionally shared).【F:remoteiq-minimal-e2e/backend/src/storage/organization-context.service.ts†L22-L47】 |

### Storage Connector Issues

| Symptom | Likely Cause | Resolution |
| --- | --- | --- |
| `Unsupported storage kind` response | Payload `kind` not in allowed list | Submit only `s3`, `nextcloud`, `gdrive`, or `sftp`, matching validation in `ensureKind`. Extend both the schema CHECK constraint and service validation if a new provider is required.【F:database/migrations/20240101_redesign.sql†L79-L84】【F:remoteiq-minimal-e2e/backend/src/storage/storage-connections.service.ts†L34-L57】 |
| Secrets overwritten with blanks after update | Empty strings passed for secret fields | Remove secret keys from the payload if they should remain unchanged. `partitionSecrets` deletes keys set to empty/undefined and preserves previous values when omitted.【F:remoteiq-minimal-e2e/backend/src/storage/storage-connections.service.ts†L159-L215】 |
| Nextcloud browse/test failing with `path must start with '/'` | Relative path sent from UI | Ensure the UI passes absolute Nextcloud paths; default path `/Backups/RemoteIQ` is applied when config omits `path`.【F:remoteiq-minimal-e2e/backend/src/storage/storage-connections.service.ts†L58-L96】【F:remoteiq-minimal-e2e/backend/src/backups/backups.service.ts†L334-L358】 |

### Backups Workflow Issues

| Symptom | Likely Cause | Resolution |
| --- | --- | --- |
| Saving backup settings errors with `Valid connectionId required` | Destination refers to non-UUID or missing storage connector | Create a connector via `/api/admin/storage/connections` first, then supply its UUID in the backup destination payload.【F:remoteiq-minimal-e2e/backend/src/backups/backups.service.ts†L334-L375】 |
| Worker fails with `Destination kind 'remote' not supported` | Remote connector upload not implemented | Limit automated uploads to `local` or `s3` destinations until additional client integrations are implemented in the worker.【F:remoteiq-minimal-e2e/backend/src/backups/worker.service.ts†L160-L199】 |
| Backup archive missing expected tables | Target name has no mapped table | Check worker logs via `backup_job_logs`; `resolveExistingTableForTarget` skips targets without a matching table. Either create a view for the new target or adjust the worker mapping logic.【F:remoteiq-minimal-e2e/backend/src/backups/worker.service.ts†L95-L140】 |
| `organizations table unavailable` warning on startup | Database migration not yet applied or connection failed | Confirm Postgres connection details; once `organizations` exists the service caches the ID and warning stops.【F:remoteiq-minimal-e2e/backend/src/storage/organization-context.service.ts†L19-L59】 |

### Frontend Role Metadata Issues

| Symptom | Likely Cause | Resolution |
| --- | --- | --- |
| Role filter shows `__none__` entries unexpectedly | Backend returned empty role metadata for some users | Ensure the backend assigns at least one role per user; `UsersTab` falls back to blank role strings when `roles[]` is empty.【F:remoteiq-frontend/app/administration/tabs/UsersTab.tsx†L88-L158】 |
| CSV exports omit secondary roles | Tab currently surfaces only primary role | Extend `updateUserRoleMetadata` and the export helpers to serialize `roles[]`. Helpers already normalize multiple entries for future enhancement.【F:remoteiq-frontend/app/administration/tabs/UsersTab.tsx†L127-L145】 |

---

*Last updated: 2025-11-06*
