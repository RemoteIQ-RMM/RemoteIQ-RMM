-- Hotfix: add columns expected by the app, without changing application code.

-- 1) Ensure localization_settings.language exists (backfill from locale)
ALTER TABLE IF EXISTS public.localization_settings
    ADD COLUMN IF NOT EXISTS language TEXT;

UPDATE public.localization_settings
SET language = COALESCE(language, locale, 'en-US');

ALTER TABLE IF EXISTS public.localization_settings
    ALTER COLUMN language SET NOT NULL;

-- 2) Add hostname to agents/devices if those tables exist, only if missing.
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
