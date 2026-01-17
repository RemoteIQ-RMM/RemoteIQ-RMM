-- Canned responses + custom template variables
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS canned_responses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canned_responses_org_idx
  ON canned_responses (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS canned_responses_org_title_uq
  ON canned_responses (organization_id, lower(title));

CREATE TABLE IF NOT EXISTS canned_variables (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canned_variables_org_idx
  ON canned_variables (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS canned_variables_org_key_uq
  ON canned_variables (organization_id, lower(key));
