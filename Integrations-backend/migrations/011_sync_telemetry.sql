-- Sync telemetry for radar health
CREATE TABLE IF NOT EXISTS sync_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  stream_type TEXT NOT NULL,
  marketplace_id TEXT NOT NULL,
  last_success TIMESTAMPTZ,
  records_ingested INTEGER,
  expected_records INTEGER,
  error_count INTEGER DEFAULT 0,
  freshness_lag_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_telemetry_user_stream ON sync_telemetry(user_id, stream_type);
CREATE INDEX IF NOT EXISTS idx_sync_telemetry_updated_at ON sync_telemetry(updated_at);

-- Basic RLS-friendly structure (optional enablement depends on auth setup)

