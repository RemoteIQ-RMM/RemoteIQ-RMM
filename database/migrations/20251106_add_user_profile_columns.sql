-- 20251106_add_user_profile_columns.sql
-- Add user profile columns expected by MeService/UsersService (idempotent)

BEGIN;

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

COMMIT;

-- Verification (optional)
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='users'
--   AND column_name IN ('phone','timezone','locale','avatar_url','avatar_thumb_url',
--                       'address1','address2','city','state','postal','country')
-- ORDER BY column_name;
