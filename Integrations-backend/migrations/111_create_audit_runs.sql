CREATE TABLE IF NOT EXISTS audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NULL,
  sync_id text NULL,
  status text NOT NULL DEFAULT 'created',
  source_type text NOT NULL DEFAULT 'sp_api',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  activation_status text NOT NULL DEFAULT 'not_activated',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_runs_status_check CHECK (
    status IN (
      'created',
      'amazon_connection_required',
      'syncing',
      'detecting',
      'completed',
      'failed',
      'activated'
    )
  ),
  CONSTRAINT audit_runs_source_type_check CHECK (source_type IN ('sp_api', 'csv_upload', 'sandbox')),
  CONSTRAINT audit_runs_activation_status_check CHECK (
    activation_status IN ('not_activated', 'pending_manual_review', 'activated')
  )
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_user_id ON audit_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_tenant_id ON audit_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON audit_runs(status);
CREATE INDEX IF NOT EXISTS idx_audit_runs_created_at ON audit_runs(created_at DESC);
