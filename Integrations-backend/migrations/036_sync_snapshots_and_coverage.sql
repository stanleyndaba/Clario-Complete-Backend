-- Migration 036: Sync Snapshots and Coverage Tracking
-- Purpose: Enable dataset versioning and sync coverage tracking for Pillars 2 & 3

-- Add sync fingerprint for idempotent job detection
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS sync_fingerprint TEXT;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS last_successful_sync_at TIMESTAMPTZ;

-- Create index for fingerprint lookups
CREATE INDEX IF NOT EXISTS idx_sync_progress_fingerprint ON sync_progress(user_id, sync_fingerprint);

-- Create sync_snapshots table for dataset versioning
CREATE TABLE IF NOT EXISTS sync_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_id TEXT,  -- References sync_progress.sync_id (TEXT type)
  user_id UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  coverage JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one snapshot per user per date
  CONSTRAINT unique_user_date_snapshot UNIQUE (user_id, snapshot_date)
);

-- Index for fast snapshot lookups
CREATE INDEX IF NOT EXISTS idx_sync_snapshots_user_date ON sync_snapshots(user_id, snapshot_date DESC);

-- Add record_hash column to key tables for deduplication (only if tables exist)
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'orders') THEN
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'shipments') THEN
    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'returns') THEN
    ALTER TABLE returns ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'settlements') THEN
    ALTER TABLE settlements ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'inventory') THEN
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
END $$;

-- Add structured error tracking to sync_progress
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS error_details JSONB;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Add coverage tracking to sync_progress
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS coverage JSONB;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS coverage_complete BOOLEAN DEFAULT FALSE;

-- Comment on new columns
COMMENT ON COLUMN sync_progress.sync_fingerprint IS 'Hash for idempotent job detection';
COMMENT ON COLUMN sync_progress.last_successful_sync_at IS 'Timestamp of last successful sync completion';
COMMENT ON COLUMN sync_progress.error_code IS 'Structured error code: RATE_LIMITED, AUTH_EXPIRED, etc.';
COMMENT ON COLUMN sync_progress.coverage IS 'Entity coverage tracking JSONB';

COMMENT ON TABLE sync_snapshots IS 'Daily snapshots of sync metrics for versioning and comparison';

