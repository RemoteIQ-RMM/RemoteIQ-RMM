-- 1) Normalize agent token columns so COALESCE(...) never mixes uuid/text.

DO $$
DECLARE
  v_token_type TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='agents'
  ) THEN
    -- Ensure agent_token TEXT exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='agents' AND column_name='agent_token'
    ) THEN
      ALTER TABLE public.agents ADD COLUMN agent_token TEXT;
    END IF;

    -- Ensure token exists and is TEXT
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='agents' AND column_name='token'
    ) THEN
      ALTER TABLE public.agents ADD COLUMN token TEXT;
    ELSE
      SELECT data_type INTO v_token_type
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name='agents' AND column_name='token';
      IF v_token_type IS NOT NULL AND v_token_type <> 'text' THEN
        ALTER TABLE public.agents
          ALTER COLUMN token TYPE TEXT USING token::text;
      END IF;
    END IF;

    -- Backfill token with best available value: token -> agent_token -> agent_uuid::text
    UPDATE public.agents a
       SET token = COALESCE(
                    NULLIF(a.token, ''),
                    NULLIF(a.agent_token, ''),
                    a.agent_uuid::text
                  )
     WHERE a.token IS NULL OR a.token = '';
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2) Add localization_settings.currency and backfill.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='currency'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN currency TEXT;
    END IF;

    UPDATE public.localization_settings
       SET currency = COALESCE(NULLIF(currency, ''), 'USD');

    ALTER TABLE public.localization_settings
      ALTER COLUMN currency SET NOT NULL;
  END IF;
END
$$ LANGUAGE plpgsql;
