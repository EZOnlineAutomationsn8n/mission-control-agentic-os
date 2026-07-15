ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_hash_idx
  ON audit_events (event_hash)
  WHERE event_hash IS NOT NULL;
