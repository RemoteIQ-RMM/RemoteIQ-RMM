-- 20251107_add_admin_access_permission.sql
-- Adds the 'admin.access' permission used to gate access to the /administration area.

BEGIN;

-- Ensure a uniqueness constraint on permission_key (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS permissions_permission_key_uidx
  ON permissions(permission_key);

-- Upsert the Administration access permission
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

COMMIT;

-- Optionally: grant to a default role (e.g., 'Admin') if you map permissions to roles.
-- Uncomment and adjust ONLY if your schema has these tables/columns.
-- DO $$
-- BEGIN
--   IF to_regclass('public.roles') IS NOT NULL
--      AND to_regclass('public.roles_permissions') IS NOT NULL THEN
--     -- Example assumes roles(id, name) and roles_permissions(role_id, permission_key)
--     INSERT INTO roles_permissions (role_id, permission_key)
--     SELECT r.id, 'admin.access'
--     FROM roles r
--     WHERE lower(r.name) IN ('admin','owner')
--     ON CONFLICT DO NOTHING;
--   END IF;
-- END
-- $$;
