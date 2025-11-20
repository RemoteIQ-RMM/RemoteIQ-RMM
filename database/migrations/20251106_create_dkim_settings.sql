-- Creates/repairs the single-row dkim_settings table used by DkimRepository.
-- Safe to run multiple times.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dkim_settings (
  id          INTEGER PRIMARY KEY,
  domain      TEXT NOT NULL DEFAULT '',
  selector    TEXT NOT NULL DEFAULT '',
  private_key TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure all columns exist
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','domain','sql','ALTER TABLE public.dkim_settings ADD COLUMN domain TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','selector','sql','ALTER TABLE public.dkim_settings ADD COLUMN selector TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','private_key','sql','ALTER TABLE public.dkim_settings ADD COLUMN private_key TEXT'),
    jsonb_build_object('name','updated_at','sql','ALTER TABLE public.dkim_settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='dkim_settings'
        AND column_name=(c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END$$;

-- Seed the singleton row (id=1) if missing
INSERT INTO public.dkim_settings (id, domain, selector, private_key)
VALUES (1, '', '', NULL)
ON CONFLICT (id) DO NOTHING;

COMMIT;
