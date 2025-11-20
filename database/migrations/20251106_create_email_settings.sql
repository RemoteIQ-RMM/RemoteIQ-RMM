-- Creates/repairs the email_settings table used by SmtpRepository.
-- Safe to run multiple times.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_settings (
  purpose            TEXT PRIMARY KEY,  -- 'alerts' | 'invites' | 'password_resets' | 'reports'
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,

  smtp_host          TEXT NOT NULL DEFAULT '',
  smtp_port          INTEGER,
  smtp_username      TEXT NOT NULL DEFAULT '',
  smtp_password      TEXT,
  smtp_use_tls       BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_use_ssl       BOOLEAN NOT NULL DEFAULT FALSE,
  smtp_from_address  TEXT NOT NULL DEFAULT '',

  imap_host          TEXT NOT NULL DEFAULT '',
  imap_port          INTEGER,
  imap_username      TEXT NOT NULL DEFAULT '',
  imap_password      TEXT,
  imap_use_ssl       BOOLEAN NOT NULL DEFAULT TRUE,

  pop_host           TEXT NOT NULL DEFAULT '',
  pop_port           INTEGER,
  pop_username       TEXT NOT NULL DEFAULT '',
  pop_password       TEXT,
  pop_use_ssl        BOOLEAN NOT NULL DEFAULT TRUE,

  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns (idempotent)
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','enabled','sql','ALTER TABLE public.email_settings ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE'),
    jsonb_build_object('name','smtp_host','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_host TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','smtp_port','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_port INTEGER'),
    jsonb_build_object('name','smtp_username','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_username TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','smtp_password','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_password TEXT'),
    jsonb_build_object('name','smtp_use_tls','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_use_tls BOOLEAN NOT NULL DEFAULT TRUE'),
    jsonb_build_object('name','smtp_use_ssl','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_use_ssl BOOLEAN NOT NULL DEFAULT FALSE'),
    jsonb_build_object('name','smtp_from_address','sql','ALTER TABLE public.email_settings ADD COLUMN smtp_from_address TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','imap_host','sql','ALTER TABLE public.email_settings ADD COLUMN imap_host TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','imap_port','sql','ALTER TABLE public.email_settings ADD COLUMN imap_port INTEGER'),
    jsonb_build_object('name','imap_username','sql','ALTER TABLE public.email_settings ADD COLUMN imap_username TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','imap_password','sql','ALTER TABLE public.email_settings ADD COLUMN imap_password TEXT'),
    jsonb_build_object('name','imap_use_ssl','sql','ALTER TABLE public.email_settings ADD COLUMN imap_use_ssl BOOLEAN NOT NULL DEFAULT TRUE'),
    jsonb_build_object('name','pop_host','sql','ALTER TABLE public.email_settings ADD COLUMN pop_host TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','pop_port','sql','ALTER TABLE public.email_settings ADD COLUMN pop_port INTEGER'),
    jsonb_build_object('name','pop_username','sql','ALTER TABLE public.email_settings ADD COLUMN pop_username TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','pop_password','sql','ALTER TABLE public.email_settings ADD COLUMN pop_password TEXT'),
    jsonb_build_object('name','pop_use_ssl','sql','ALTER TABLE public.email_settings ADD COLUMN pop_use_ssl BOOLEAN NOT NULL DEFAULT TRUE'),
    jsonb_build_object('name','updated_at','sql','ALTER TABLE public.email_settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='email_settings'
        AND column_name = (c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END$$;

-- Seed defaults for required purposes if missing (without overwriting)
INSERT INTO public.email_settings (purpose, enabled, smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, smtp_use_ssl, smtp_from_address,
                                   imap_host, imap_port, imap_username, imap_password, imap_use_ssl,
                                   pop_host, pop_port, pop_username, pop_password, pop_use_ssl, updated_at)
SELECT x.purpose, TRUE, '', 587, '', NULL, TRUE, FALSE, '',
       '', 993, '', NULL, TRUE,
       '', 995, '', NULL, TRUE, NOW()
FROM (VALUES ('alerts'), ('invites'), ('password_resets'), ('reports')) AS x(purpose)
WHERE NOT EXISTS (SELECT 1 FROM public.email_settings s WHERE s.purpose = x.purpose);

COMMIT;
