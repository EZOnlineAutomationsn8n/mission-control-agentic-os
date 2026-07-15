CREATE TABLE IF NOT EXISTS approval_decisions (
  sequence BIGSERIAL PRIMARY KEY,
  approval_id TEXT UNIQUE NOT NULL,
  connector_id TEXT NOT NULL,
  requested_capability TEXT NOT NULL,
  context TEXT,
  risk_level TEXT
    CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical')),
  requested_at TIMESTAMPTZ,
  status TEXT NOT NULL
    CHECK (status IN ('approved', 'rejected')),
  reason TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL DEFAULT 'operator'
    CHECK (actor = 'operator'),
  UNIQUE (connector_id, requested_capability)
);

CREATE INDEX IF NOT EXISTS approval_decisions_time_idx
  ON approval_decisions (decided_at DESC, sequence DESC);
CREATE INDEX IF NOT EXISTS approval_decisions_connector_idx
  ON approval_decisions (connector_id, decided_at DESC);
