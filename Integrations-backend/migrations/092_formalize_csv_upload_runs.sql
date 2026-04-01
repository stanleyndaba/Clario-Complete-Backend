-- Migration: 092_formalize_csv_upload_runs
-- Purpose: promote csv_upload_runs into the authoritative tenant-scoped CSV batch lifecycle record

ALTER TABLE csv_upload_runs
  ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS file_count INTEGER,
  ADD COLUMN IF NOT EXISTS files_summary JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS error TEXT,
  ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE csv_upload_runs
SET seller_id = COALESCE(seller_id, user_id)
WHERE seller_id IS NULL;

UPDATE csv_upload_runs
SET started_at = COALESCE(started_at, created_at)
WHERE started_at IS NULL;

UPDATE csv_upload_runs
SET file_count = COALESCE(file_count, total_files, jsonb_array_length(COALESCE(ingestion_results, '[]'::jsonb)))
WHERE file_count IS NULL;

UPDATE csv_upload_runs
SET files_summary = COALESCE(files_summary, ingestion_results, '[]'::jsonb)
WHERE files_summary IS NULL
   OR files_summary = '[]'::jsonb;

UPDATE csv_upload_runs
SET status = COALESCE(
  status,
  CASE
    WHEN detection_triggered THEN 'detection_processing'
    WHEN success THEN 'completed'
    ELSE 'failed'
  END
)
WHERE status IS NULL;

UPDATE csv_upload_runs
SET completed_at = COALESCE(
  completed_at,
  CASE
    WHEN status IN ('completed', 'partial', 'failed') THEN updated_at
    ELSE NULL
  END
)
WHERE completed_at IS NULL;

ALTER TABLE csv_upload_runs
  ALTER COLUMN seller_id SET NOT NULL,
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN file_count SET NOT NULL,
  ALTER COLUMN files_summary SET NOT NULL;

ALTER TABLE csv_upload_runs
  ALTER COLUMN started_at SET DEFAULT NOW(),
  ALTER COLUMN status SET DEFAULT 'started',
  ALTER COLUMN file_count SET DEFAULT 0,
  ALTER COLUMN files_summary SET DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_csv_upload_runs_tenant_seller_started
  ON csv_upload_runs (tenant_id, seller_id, started_at DESC);

COMMENT ON COLUMN csv_upload_runs.seller_id IS 'Seller/app user who owns this CSV batch.';
COMMENT ON COLUMN csv_upload_runs.started_at IS 'When the CSV batch lifecycle record was created.';
COMMENT ON COLUMN csv_upload_runs.completed_at IS 'When the CSV batch reached a terminal state.';
COMMENT ON COLUMN csv_upload_runs.status IS 'Authoritative lifecycle state: started, detection_processing, completed, partial, or failed.';
COMMENT ON COLUMN csv_upload_runs.file_count IS 'Number of files accepted into the batch.';
COMMENT ON COLUMN csv_upload_runs.files_summary IS 'Per-file persisted summary for refresh-safe CSV history.';
COMMENT ON COLUMN csv_upload_runs.error IS 'Batch-level error truth when the CSV run is partial or failed.';
COMMENT ON COLUMN csv_upload_runs.is_sandbox IS 'Whether the CSV batch detection ran in sandbox/dev mode.';
