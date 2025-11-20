-- Creates/repairs the single-row support_legal table expected by SupportLegalService.
-- Safe to run multiple times.

BEGIN;

-- 1) Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.support_legal (
  id                 INTEGER PRIMARY KEY,
  support_email      TEXT,
  support_phone      TEXT,
  knowledge_base_url TEXT,
  status_page_url    TEXT,
  privacy_policy_url TEXT,
  terms_url          TEXT,
  gdpr_contact_email TEXT,
  legal_address      TEXT,
  ticket_portal_url  TEXT,
  phone_hours        TEXT,
  notes_html         TEXT
);

-- 2) Add any missing columns (idempotent)
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','support_email','sql','ALTER TABLE public.support_legal ADD COLUMN support_email TEXT'),
    jsonb_build_object('name','support_phone','sql','ALTER TABLE public.support_legal ADD COLUMN support_phone TEXT'),
    jsonb_build_object('name','knowledge_base_url','sql','ALTER TABLE public.support_legal ADD COLUMN knowledge_base_url TEXT'),
    jsonb_build_object('name','status_page_url','sql','ALTER TABLE public.support_legal ADD COLUMN status_page_url TEXT'),
    jsonb_build_object('name','privacy_policy_url','sql','ALTER TABLE public.support_legal ADD COLUMN privacy_policy_url TEXT'),
    jsonb_build_object('name','terms_url','sql','ALTER TABLE public.support_legal ADD COLUMN terms_url TEXT'),
    jsonb_build_object('name','gdpr_contact_email','sql','ALTER TABLE public.support_legal ADD COLUMN gdpr_contact_email TEXT'),
    jsonb_build_object('name','legal_address','sql','ALTER TABLE public.support_legal ADD COLUMN legal_address TEXT'),
    jsonb_build_object('name','ticket_portal_url','sql','ALTER TABLE public.support_legal ADD COLUMN ticket_portal_url TEXT'),
    jsonb_build_object('name','phone_hours','sql','ALTER TABLE public.support_legal ADD COLUMN phone_hours TEXT'),
    jsonb_build_object('name','notes_html','sql','ALTER TABLE public.support_legal ADD COLUMN notes_html TEXT')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='support_legal'
        AND column_name = (c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END$$;

-- 3) Ensure the singleton row exists
INSERT INTO public.support_legal (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMIT;
