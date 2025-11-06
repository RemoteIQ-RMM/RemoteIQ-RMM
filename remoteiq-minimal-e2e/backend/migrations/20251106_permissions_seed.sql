-- 20251106_permissions_seed.sql
-- Seeds standard permissions; ensures Owner/Admin roles and grants.
-- Safe to run multiple times.

BEGIN;

-- Helper upsert function for permissions
CREATE OR REPLACE FUNCTION public._upsert_permission(
  p_key text, p_label text, p_group_key text, p_group_label text
) RETURNS void AS $$
BEGIN
  INSERT INTO public.permissions (key, label, group_key, group_label)
  VALUES (p_key, p_label, p_group_key, p_group_label)
  ON CONFLICT (key) DO UPDATE
    SET label       = EXCLUDED.label,
        group_key   = EXCLUDED.group_key,
        group_label = EXCLUDED.group_label;
END
$$ LANGUAGE plpgsql;

-- ===== Users =====
SELECT public._upsert_permission('users.read',       'View users',         'users','Users');
SELECT public._upsert_permission('users.write',      'Create/edit users',  'users','Users');
SELECT public._upsert_permission('users.delete',     'Remove users',       'users','Users');
SELECT public._upsert_permission('users.2fa.reset',  'Reset 2FA',          'users','Users');

-- ===== Roles =====
SELECT public._upsert_permission('roles.read',   'roles.read',   'roles','Roles');
SELECT public._upsert_permission('roles.write',  'roles.write',  'roles','Roles');
SELECT public._upsert_permission('roles.delete', 'roles.delete', 'roles','Roles');

-- ===== Teams =====
SELECT public._upsert_permission('teams.read',   'teams.read',   'teams','Teams');
SELECT public._upsert_permission('teams.write',  'teams.write',  'teams','Teams');
SELECT public._upsert_permission('teams.delete', 'teams.delete', 'teams','Teams');

-- ===== Billing =====
SELECT public._upsert_permission('billing.read',  'billing.read',  'billing','Billing');
SELECT public._upsert_permission('billing.write', 'billing.write', 'billing','Billing');

-- ===== Settings =====
SELECT public._upsert_permission('settings.read',  'settings.read',  'settings','Settings');
SELECT public._upsert_permission('settings.write', 'settings.write', 'settings','Settings');

-- ===== Backups =====
SELECT public._upsert_permission('backups.manage',   'Manage backups (run/config)', 'backups','Backups');
SELECT public._upsert_permission('backups.restore',  'Restore from backups',        'backups','Backups');
SELECT public._upsert_permission('backups.download', 'Download backup artifacts',   'backups','Backups');

-- Cleanup helper
DROP FUNCTION IF EXISTS public._upsert_permission(text,text,text,text);

-- Ensure Owner/Admin roles exist (with descriptions)
INSERT INTO public.roles (id, name, description)
SELECT gen_random_uuid(), 'Owner', 'Full system access'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE lower(name)='owner');

INSERT INTO public.roles (id, name, description)
SELECT gen_random_uuid(), 'Admin', 'Administrative access'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE lower(name)='admin');

-- Grant Owner every permission
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE lower(r.name)='owner'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id=r.id AND rp.permission_id=p.id
  );

-- Grant Admin a curated set (edit as needed)
WITH admin_role AS (
  SELECT id FROM public.roles WHERE lower(name)='admin'
),
wanted AS (
  SELECT id FROM public.permissions WHERE key IN (
    'users.read','users.write','users.delete','users.2fa.reset',
    'roles.read','roles.write','roles.delete',
    'teams.read','teams.write','teams.delete',
    'billing.read','billing.write',
    'settings.read','settings.write',
    'backups.manage','backups.restore','backups.download'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT ar.id, w.id
FROM admin_role ar
JOIN wanted w ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp
  WHERE rp.role_id = ar.id AND rp.permission_id = w.id
);

COMMIT;
