CREATE TABLE IF NOT EXISTS operator_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  workspace_path TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operator_work_items (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES operator_projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'capture'
    CHECK (stage IN ('capture', 'human-gate', 'execute', 'shipped')),
  assigned_agent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operator_work_items_stage_idx
  ON operator_work_items (stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS operator_work_items_project_idx
  ON operator_work_items (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS operator_work_events (
  sequence BIGSERIAL PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES operator_work_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operator_work_events_item_idx
  ON operator_work_events (work_item_id, sequence DESC);
