CREATE INDEX IF NOT EXISTS idx_oc_tasks_tenant_created ON oc_tasks (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_tasks_tenant_status ON oc_tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_oc_tasks_tenant_run ON oc_tasks (tenant_id, run_id);

CREATE INDEX IF NOT EXISTS idx_oc_risks_tenant_created ON oc_risks (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_risks_tenant_status_severity ON oc_risks (tenant_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_oc_risks_tenant_run ON oc_risks (tenant_id, run_id);

CREATE INDEX IF NOT EXISTS idx_oc_schedule_events_tenant_start ON oc_schedule_events (tenant_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_crm_accounts_tenant_risk ON oc_crm_accounts (tenant_id, risk_level, risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_oc_crm_interactions_tenant_time ON oc_crm_interactions (tenant_id, interaction_at DESC);

CREATE INDEX IF NOT EXISTS idx_oc_supply_signals_tenant_detected ON oc_supply_signals (tenant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_recommendations_tenant_state ON oc_recommendations (tenant_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_recommendations_tenant_run ON oc_recommendations (tenant_id, run_id);

CREATE INDEX IF NOT EXISTS idx_oc_proactive_briefs_tenant_created ON oc_proactive_briefs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_runs_audit_tenant_started ON oc_runs_audit (tenant_id, started_at DESC);
