-- Create table for per-organization localization settings
CREATE TABLE IF NOT EXISTS public.localization_settings (
  organization_id UUID PRIMARY KEY,
  locale           TEXT        NOT NULL DEFAULT 'en-US',
  timezone         TEXT        NOT NULL DEFAULT 'America/New_York',
  date_format      TEXT        NOT NULL DEFAULT 'yyyy-MM-dd',   -- e.g. 2025-11-06
  time_format      TEXT        NOT NULL DEFAULT 'HH:mm',        -- 24h by default
  number_format    TEXT        NOT NULL DEFAULT '1,234.56',
  first_day_of_week INT        NOT NULL DEFAULT 0,              -- 0=Sunday, 1=Monday
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bump updated_at on any update
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_localization_settings_touch ON public.localization_settings;
CREATE TRIGGER trg_localization_settings_touch
BEFORE UPDATE ON public.localization_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Optional: backfill a row for the default organization if you have one.
-- If your organizations live in `public.organizations` and your app uses the
-- "default" org (the first or id=1 type), this will insert defaults for any orgs missing a row.

INSERT INTO public.localization_settings (organization_id)
SELECT o.id
FROM public.organizations o
LEFT JOIN public.localization_settings ls ON ls.organization_id = o.id
WHERE ls.organization_id IS NULL;
