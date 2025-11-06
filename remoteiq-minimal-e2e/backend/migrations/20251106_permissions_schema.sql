-- 20251106_permissions_schema.sql
-- Creates roles.description, permissions, and role_permissions (idempotent)

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Roles: add description column if missing
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS description text;

-- 2) Permissions master table
CREATE TABLE IF NOT EXISTS public.permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,         -- e.g. 'users.read'
  label       text NOT NULL,                -- human label
  group_key   text NOT NULL,                -- e.g. 'users'
  group_label text NOT NULL,                -- e.g. 'Users'
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Helpful indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='permissions_group_key_idx'
  ) THEN
    CREATE INDEX permissions_group_key_idx ON public.permissions (group_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='permissions_key_idx'
  ) THEN
    CREATE INDEX permissions_key_idx ON public.permissions (key);
  END IF;
END$$;

-- 3) Role ↔ Permission link table (composite PK)
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id       uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

COMMIT;
