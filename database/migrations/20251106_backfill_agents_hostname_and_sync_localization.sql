-- Backfill agents.hostname from devices.hostname (one-time)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='agents'  AND column_name='hostname')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='agents'  AND column_name='device_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='devices' AND column_name='hostname')
  THEN
    UPDATE public.agents a
       SET hostname = d.hostname
      FROM public.devices d
     WHERE a.device_id = d.id
       AND (a.hostname IS NULL OR a.hostname = '');
  END IF;
END
$$ LANGUAGE plpgsql;

-- Ensure localization_settings rows exist and align with organizations.time_zone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) THEN
    INSERT INTO public.localization_settings (organization_id, locale, language, timezone, time_zone)
    SELECT o.id,
           'en-US'::text,
           'en-US'::text,
           COALESCE(o.time_zone, 'UTC'),
           COALESCE(o.time_zone, 'UTC')
      FROM public.organizations o
 LEFT JOIN public.localization_settings ls ON ls.organization_id = o.id
     WHERE ls.organization_id IS NULL;

    UPDATE public.localization_settings ls
       SET timezone  = COALESCE(NULLIF(ls.timezone,  ''), o.time_zone, 'UTC'),
           time_zone = COALESCE(NULLIF(ls.time_zone, ''), o.time_zone, 'UTC'),
           language  = COALESCE(NULLIF(ls.language,  ''), 'en-US')
      FROM public.organizations o
     WHERE o.id = ls.organization_id;
  END IF;
END
$$ LANGUAGE plpgsql;
