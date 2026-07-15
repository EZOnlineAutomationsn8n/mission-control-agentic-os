CREATE TABLE IF NOT EXISTS shared_brain_sources (
  id TEXT PRIMARY KEY,
  source_path TEXT UNIQUE NOT NULL,
  artifact_kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  classification TEXT NOT NULL
    CHECK (classification IN ('canonical', 'candidate', 'legacy', 'archive', 'duplicate')),
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  source_modified_at TIMESTAMPTZ NOT NULL,
  duplicate_of TEXT,
  notes TEXT NOT NULL DEFAULT '',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shared_brain_sources_hash_idx ON shared_brain_sources (sha256);
CREATE INDEX IF NOT EXISTS shared_brain_sources_scope_idx ON shared_brain_sources (scope, classification);

CREATE TABLE IF NOT EXISTS shared_brain_events (
  sequence BIGSERIAL PRIMARY KEY,
  id TEXT UNIQUE NOT NULL,
  event_at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS shared_brain_events_time_idx ON shared_brain_events (event_at DESC, sequence DESC);
