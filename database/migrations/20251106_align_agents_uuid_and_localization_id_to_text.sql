-- Convert agents.agent_uuid -> TEXT so COALESCE with text works everywhere.
DO $$
DECLARE
  v_exists boolean;
  v_type   text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='agent_uuid'
  ) INTO v_exists;

  IF v_exists THEN
    SELECT data_type
      INTO v_type
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agents' AND column_name='agent_uuid';

    IF v_type <> 'text' THEN
      -- Drop dependent indexes on agent_uuid if any (keep constraint safety by re-adding).
      -- Most setups only have a UNIQUE constraint; we’ll recreate it.
      PERFORM 1
      FROM   pg_indexes
      WHERE  schemaname='public'
        AND  tablename='agents'
        AND  indexname='agents_agent_uuid_key';

      -- If a unique index exists under that name, drop it before changing type.
      IF EXISTS (
        SELECT 1
        FROM   pg_constraint c
        JOIN   pg_class     t ON c.conrelid = t.oid
        JOIN   pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
        WHERE  t.relname = 'agents'
          AND  c.conname = 'agents_agent_uuid_key'
      ) THEN
        ALTER TABLE public.agents DROP CONSTRAINT agents_agent_uuid_key;
      END IF;

      -- Convert to TEXT
      ALTER TABLE public.agents
        ALTER COLUMN agent_uuid TYPE TEXT USING agent_uuid::text;

      -- Recreate uniqueness on the text column
      ALTER TABLE public.agents
        ADD CONSTRAINT agents_agent_uuid_key UNIQUE (agent_uuid);
    END IF;
  END IF;
END
$$ LANGUAGE plpgsql;

-- Ensure agents.token is TEXT (if still not), and backfill smartly
DO $$
DECLARE
  v_type text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='agents' AND column_name='token') THEN
    SELECT data_type INTO v_type
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agents' AND column_name='token';
    IF v_type <> 'text' THEN
      ALTER TABLE public.agents
        ALTER COLUMN token TYPE TEXT USING token::text;
    END IF;
  ELSE
    ALTER TABLE public.agents ADD COLUMN token TEXT;
  END IF;

  -- Ensure agent_token exists and is TEXT
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='agent_token'
  ) THEN
    ALTER TABLE public.agents ADD COLUMN agent_token TEXT;
  END IF;

  -- Backfill token with the best available string
  UPDATE public.agents a
     SET token = COALESCE(NULLIF(a.token, ''), NULLIF(a.agent_token, ''), NULLIF(a.agent_uuid, ''))
   WHERE a.token IS NULL OR a.token = '';
END
$$ LANGUAGE plpgsql;

-- Make agents.hostname exist (already done earlier, but keep idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='agents')
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='agents' AND column_name='hostname'
     )
  THEN
    ALTER TABLE public.agents ADD COLUMN hostname TEXT;
  END IF;
END
$$ LANGUAGE plpgsql;

-- Backfill agents.hostname once from devices.hostname if blank
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

-- For localization_settings: make 'id' a TEXT mirror of organization_id to tolerate 'id' = '1' style lookups.
DO $$
DECLARE
  v_exists boolean;
  v_type   text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='localization_settings'
  ) INTO v_exists;

  IF v_exists THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='localization_settings' AND column_name='id'
    ) THEN
      ALTER TABLE public.localization_settings ADD COLUMN id TEXT;
      UPDATE public.localization_settings SET id = organization_id::text WHERE id IS NULL;
    ELSE
      SELECT data_type INTO v_type
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name='localization_settings' AND column_name='id';
      IF v_type <> 'text' THEN
        ALTER TABLE public.localization_settings
          ALTER COLUMN id TYPE TEXT USING id::text;
      END IF;
      UPDATE public.localization_settings SET id = organization_id::text WHERE id IS NULL OR id = '';
    END IF;

    -- Keep it unique and non-null (separate from PK on organization_id)
    DO $inner$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename='localization_settings' AND indexname='uq_localization_settings_id_text'
      ) THEN
        CREATE UNIQUE INDEX uq_localization_settings_id_text ON public.localization_settings(id);
      END IF;
    END
    $inner$;
  END IF;
END
$$ LANGUAGE plpgsql;
