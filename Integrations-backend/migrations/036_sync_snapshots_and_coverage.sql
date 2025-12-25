-- Migration 036: Sync Snapshots and Coverage Tracking
-- Purpose: Enable dataset versioning and sync coverage tracking for Pillars 2 & 3

-- Add sync fingerprint for idempotent job detection
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS sync_fingerprint TEXT;
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS last_successful_sync_at TIMESTAMPTZ;

-- Create index for fingerprint lookups
CREATE INDEX IF NOT EXISTS idx_sync_jobs_fingerprint ON sync_jobs(user_id, sync_fingerprint);

-- Create sync_snapshots table for dataset versioning
CREATE TABLE IF NOT EXISTS sync_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_id UUID REFERENCES sync_jobs(id) ON DELETE CASCADE,
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

-- Add record_hash column to key tables for deduplication
ALTER TABLE orders ADD COLUMN IF NOT EXISTS record_hash TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS record_hash TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS record_hash TEXT;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS record_hash TEXT;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS record_hash TEXT;

-- Create indexes for record hash lookups (for upsert operations)
CREATE INDEX IF NOT EXISTS idx_orders_record_hash ON orders(record_hash);
CREATE INDEX IF NOT EXISTS idx_shipments_record_hash ON shipments(record_hash);
CREATE INDEX IF NOT EXISTS idx_returns_record_hash ON returns(record_hash);
CREATE INDEX IF NOT EXISTS idx_settlements_record_hash ON settlements(record_hash);
CREATE INDEX IF NOT EXISTS idx_inventory_record_hash ON inventory(record_hash);

-- Add structured error tracking to sync_jobs
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS error_details JSONB;
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Add coverage tracking to sync_jobs
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS coverage JSONB;
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS coverage_complete BOOLEAN DEFAULT FALSE;

-- Comment on new columns
COMMENT ON COLUMN sync_jobs.sync_fingerprint IS 'Hash for idempotent job detection';
COMMENT ON COLUMN sync_jobs.last_successful_sync_at IS 'Timestamp of last successful sync completion';
COMMENT ON COLUMN sync_jobs.error_code IS 'Structured error code: RATE_LIMITED, AUTH_EXPIRED, etc.';
COMMENT ON COLUMN sync_jobs.coverage IS 'Entity coverage tracking JSONB';

COMMENT ON TABLE sync_snapshots IS 'Daily snapshots of sync metrics for versioning and comparison';
