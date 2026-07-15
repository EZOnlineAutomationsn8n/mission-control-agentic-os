CREATE TABLE IF NOT EXISTS agent_sessions (
  session_kind TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_kind, agent_id, session_key)
);

CREATE TABLE IF NOT EXISTS conversation_entries (
  sequence BIGSERIAL UNIQUE NOT NULL,
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_entries_scope_idx
  ON conversation_entries (agent_id, session_id, sequence DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  sequence BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  event_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_time_idx ON audit_events (event_at DESC, sequence DESC);

CREATE TABLE IF NOT EXISTS attachment_records (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS attachment_records_scope_idx
  ON attachment_records (agent_id, session_id, created_at DESC);
