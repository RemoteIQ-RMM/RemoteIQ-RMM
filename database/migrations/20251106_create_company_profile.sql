-- Creates/repairs the single-row company profile table expected by CompanyService.
-- Safe to run multiple times (idempotent).

BEGIN;

-- 1) Create table if not exists
CREATE TABLE IF NOT EXISTS public.company_profile (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  legal_name TEXT,
  email      TEXT,
  phone      TEXT,
  fax        TEXT,
  website    TEXT,
  vat_tin    TEXT,
  address1   TEXT,
  address2   TEXT,
  city       TEXT,
  state      TEXT,
  postal     TEXT,
  country    TEXT
);

-- 2) Add any missing columns (handles older/different layouts)
DO $$
DECLARE
  cols JSONB := jsonb_build_array(
    jsonb_build_object('name','name','sql','ALTER TABLE public.company_profile ADD COLUMN name TEXT NOT NULL DEFAULT '''''),
    jsonb_build_object('name','legal_name','sql','ALTER TABLE public.company_profile ADD COLUMN legal_name TEXT'),
    jsonb_build_object('name','email','sql','ALTER TABLE public.company_profile ADD COLUMN email TEXT'),
    jsonb_build_object('name','phone','sql','ALTER TABLE public.company_profile ADD COLUMN phone TEXT'),
    jsonb_build_object('name','fax','sql','ALTER TABLE public.company_profile ADD COLUMN fax TEXT'),
    jsonb_build_object('name','website','sql','ALTER TABLE public.company_profile ADD COLUMN website TEXT'),
    jsonb_build_object('name','vat_tin','sql','ALTER TABLE public.company_profile ADD COLUMN vat_tin TEXT'),
    jsonb_build_object('name','address1','sql','ALTER TABLE public.company_profile ADD COLUMN address1 TEXT'),
    jsonb_build_object('name','address2','sql','ALTER TABLE public.company_profile ADD COLUMN address2 TEXT'),
    jsonb_build_object('name','city','sql','ALTER TABLE public.company_profile ADD COLUMN city TEXT'),
    jsonb_build_object('name','state','sql','ALTER TABLE public.company_profile ADD COLUMN state TEXT'),
    jsonb_build_object('name','postal','sql','ALTER TABLE public.company_profile ADD COLUMN postal TEXT'),
    jsonb_build_object('name','country','sql','ALTER TABLE public.company_profile ADD COLUMN country TEXT')
  );
  c JSONB;
BEGIN
  FOR c IN SELECT * FROM jsonb_array_elements(cols)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'company_profile'
        AND column_name = (c->>'name')
    ) THEN
      EXECUTE c->>'sql';
    END IF;
  END LOOP;
END$$;

-- 3) Ensure the singleton row id=1 exists (with a default name if blank)
INSERT INTO public.company_profile (id, name)
VALUES (1, 'Your Company')
ON CONFLICT (id) DO NOTHING;

-- If the name is empty, give it a sensible default.
UPDATE public.company_profile
   SET name = COALESCE(NULLIF(name, ''), 'Your Company')
 WHERE id = 1;

COMMIT;
