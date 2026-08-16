-- Ensure one manual-report Recovery Audit represents one CSV upload sync per tenant/user.
-- This preserves the separate SP-API and manual-report audit rails without a multi-source join table.

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_runs_csv_upload_sync_unique
  ON audit_runs (tenant_id, user_id, sync_id)
  WHERE source_type = 'csv_upload' AND sync_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_runs_csv_upload_lookup
  ON audit_runs (tenant_id, user_id, source_type, sync_id, created_at DESC)
  WHERE source_type = 'csv_upload';
