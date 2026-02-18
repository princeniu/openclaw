CREATE TABLE IF NOT EXISTS oc_workflow_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oc_workflow_events_tenant_run ON oc_workflow_events (tenant_id, run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_workflow_events_workflow ON oc_workflow_events (workflow_name, created_at DESC);
