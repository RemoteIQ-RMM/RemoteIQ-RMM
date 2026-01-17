-- Adds due date + minimal persistence for ticket activity, links, history
-- Safe to run multiple times.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS due_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS ticket_activity (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reply','note')),
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  time_worked_seconds int NOT NULL DEFAULT 0,
  notify_customer boolean NOT NULL DEFAULT true,
  author text NOT NULL DEFAULT 'Unknown',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_activity_ticket_id_created_at_idx
  ON ticket_activity(ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_links (
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  linked_ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'Unknown',
  CONSTRAINT ticket_links_not_self CHECK (ticket_id <> linked_ticket_id),
  CONSTRAINT ticket_links_unique_pair UNIQUE (ticket_id, linked_ticket_id)
);

CREATE INDEX IF NOT EXISTS ticket_links_ticket_id_idx ON ticket_links(ticket_id);

CREATE TABLE IF NOT EXISTS ticket_history (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  who text NOT NULL DEFAULT 'Unknown',
  what text NOT NULL
);

CREATE INDEX IF NOT EXISTS ticket_history_ticket_id_at_idx
  ON ticket_history(ticket_id, at DESC);
