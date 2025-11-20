-- Ensure required columns exist on localization_settings, then sync rows.
-- Pure SQL/PLpgSQL (no psql meta-commands), safe to run in pgAdmin.

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

    -- Backfill time_zone from existing timezone column (if present) or organizations.time_zone
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
    -- Insert missing org rows (now that columns exist)
    INSERT INTO public.localization_settings (organization_id, locale, language, timezone, time_zone)
    SELECT o.id,
           'en-US'::text,
           'en-US'::text,
           COALESCE(o.time_zone, 'UTC'),
           COALESCE(o.time_zone, 'UTC')
      FROM public.organizations o
 LEFT JOIN public.localization_settings ls ON ls.organization_id = o.id
     WHERE ls.organization_id IS NULL;

    -- Align existing rows with organizations.time_zone when blanks/NULLs
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
