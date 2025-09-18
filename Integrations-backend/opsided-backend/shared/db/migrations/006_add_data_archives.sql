-- Data archives table for raw dataset indexing and audit
CREATE TABLE IF NOT EXISTS data_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(64) NOT NULL,
  dataset TEXT NOT NULL,
  storage_type TEXT NOT NULL CHECK (storage_type IN ('s3','postgres')),
  location TEXT NOT NULL,
  job_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_data_archives_user_dataset ON data_archives (user_id, dataset);
CREATE INDEX IF NOT EXISTS idx_data_archives_created_at ON data_archives (created_at DESC);







