CREATE TABLE IF NOT EXISTS audit_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('sp_api', 'csv_upload')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'attached', 'consumed', 'abandoned', 'expired')),
  user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  tenant_id uuid NULL REFERENCES tenants(id) ON DELETE SET NULL,
  audit_run_id uuid NULL REFERENCES audit_runs(id) ON DELETE SET NULL,
  return_path text NOT NULL DEFAULT '/audit',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  attached_at timestamptz NULL,
  consumed_at timestamptz NULL,
  abandoned_at timestamptz NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_intents_user_status
  ON audit_intents(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_intents_tenant_status
  ON audit_intents(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_intents_audit_run_id
  ON audit_intents(audit_run_id)
  WHERE audit_run_id IS NOT NULL;
