CREATE TABLE IF NOT EXISTS audit_control_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coverage_start timestamptz NOT NULL,
  coverage_end timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  data_freshness text NOT NULL DEFAULT 'DATA_INCOMPLETE' CHECK (data_freshness IN ('UNDER_CONTROL', 'ACTION_REQUIRED', 'DATA_INCOMPLETE')),
  event_population jsonb NOT NULL DEFAULT '{}'::jsonb,
  automatic_reimbursements numeric(12,2) NOT NULL DEFAULT 0,
  manual_reimbursements numeric(12,2) NOT NULL DEFAULT 0,
  reversals numeric(12,2) NOT NULL DEFAULT 0,
  exceptions_investigated integer NOT NULL DEFAULT 0,
  unresolved_recoveries integer NOT NULL DEFAULT 0,
  evidence_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  deadlines_approaching jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_cases integer NOT NULL DEFAULT 0,
  control_status text NOT NULL DEFAULT 'DATA_INCOMPLETE' CHECK (control_status IN ('UNDER_CONTROL', 'ACTION_REQUIRED', 'DATA_INCOMPLETE')),
  source_lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_control_statements_audit_run
  ON audit_control_statements(audit_run_id);

ALTER TABLE audit_runs
  ADD COLUMN IF NOT EXISTS previous_audit_id uuid NULL REFERENCES audit_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_audit_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS next_eligible_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS commercial_state text NULL,
  ADD COLUMN IF NOT EXISTS commercial_route text NULL,
  ADD COLUMN IF NOT EXISTS commercial_reason text NULL,
  ADD COLUMN IF NOT EXISTS commercial_eligibility text NULL,
  ADD COLUMN IF NOT EXISTS commercial_evidence_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS commercial_decided_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS commercial_comparison jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS control_statement_id uuid NULL REFERENCES audit_control_statements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_runs_next_eligible_at ON audit_runs(next_eligible_at);
CREATE INDEX IF NOT EXISTS idx_audit_runs_commercial_route ON audit_runs(commercial_route);
