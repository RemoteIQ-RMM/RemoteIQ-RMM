-- 1) Make COALESCE(uuid, text) work by allowing an implicit cast uuid -> text.
--    This is global and safe for this app (lets PostgreSQL find a common type = text).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_cast c
    JOIN pg_type s ON c.castsource = s.oid
    JOIN pg_type t ON c.casttarget = t.oid
    WHERE s.typname = 'uuid' AND t.typname = 'text' AND c.castcontext = 'i'  -- 'i' = implicit
  ) THEN
    -- WITH INOUT defines the cast using I/O functions; AS IMPLICIT makes it usable in COALESCE, etc.
    CREATE CAST (uuid AS text) WITH INOUT AS IMPLICIT;
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2) Ensure localization_settings has an 'id' column mirroring organization_id (for code paths that SELECT id).
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
      -- Backfill id from organization_id
      UPDATE public.localization_settings SET id = organization_id WHERE id IS NULL;
      -- Enforce not null and uniqueness (organization_id remains the primary key)
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
