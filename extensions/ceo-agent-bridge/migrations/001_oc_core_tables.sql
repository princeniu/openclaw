CREATE TABLE IF NOT EXISTS oc_tasks (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  source_module TEXT NOT NULL,
  owner_id TEXT,
  due_at TEXT,
  status TEXT NOT NULL,
  risk_level TEXT,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oc_risks (
  risk_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  risk_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  suggestion TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oc_schedule_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  title TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  event_type TEXT,
  participants_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oc_crm_accounts (
  account_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_id TEXT,
  contribution_value REAL,
  risk_score REAL DEFAULT 0,
  risk_level TEXT DEFAULT 'low',
  last_contact_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oc_crm_interactions (
  interaction_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  interaction_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oc_supply_signals (
  signal_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  supplier_id TEXT,
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  value REAL,
  context_json TEXT,
  detected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oc_recommendations (
  recommendation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  recommendation_type TEXT NOT NULL,
  source_signal_id TEXT,
  reason TEXT,
  suggested_action TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  owner_id TEXT,
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oc_proactive_briefs (
  brief_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  brief_type TEXT NOT NULL,
  context_window TEXT,
  items_json TEXT NOT NULL,
  status TEXT NOT NULL,
  delivered_channel TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS oc_runs_audit (
  run_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  status TEXT NOT NULL,
  request_id TEXT,
  session_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_summary TEXT,
  details_json TEXT
);
