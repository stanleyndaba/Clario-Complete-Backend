-- Migration: 091_create_csv_upload_runs
-- Purpose: persist CSV upload batch truth so Data Upload can reconstruct runs after refresh

CREATE TABLE IF NOT EXISTS csv_upload_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sync_id TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  total_files INTEGER NOT NULL DEFAULT 0,
  detection_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  detection_job_id TEXT,
  ingestion_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS csv_upload_runs_sync_id_unique
  ON csv_upload_runs (sync_id);

CREATE INDEX IF NOT EXISTS idx_csv_upload_runs_tenant_user_created
  ON csv_upload_runs (tenant_id, user_id, created_at DESC);

COMMENT ON TABLE csv_upload_runs IS 'Persisted CSV upload batch truth keyed by sync_id for refresh-safe rehydration.';
COMMENT ON COLUMN csv_upload_runs.ingestion_results IS 'Original per-file ingestion result payload returned to the Data Upload page.';
