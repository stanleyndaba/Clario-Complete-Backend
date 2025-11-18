-- Phase 2+: Sync tracking + Discovery Agent persistence tables
-- Ensures sync_progress, detection_queue, and detection_results exist

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. SYNC PROGRESS TABLE ------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    sync_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    progress INTEGER NOT NULL DEFAULT 0,
    step INTEGER DEFAULT 0,
    total_steps INTEGER DEFAULT 5,
    current_step TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sync_progress
    ADD CONSTRAINT sync_progress_sync_id_unique UNIQUE (sync_id);

CREATE INDEX IF NOT EXISTS idx_sync_progress_user_id ON sync_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_progress_status ON sync_progress(status);
CREATE INDEX IF NOT EXISTS idx_sync_progress_created_at ON sync_progress(created_at);

COMMENT ON TABLE sync_progress IS 'Tracks Agent 2 sync jobs, status, and metadata for frontend/API.';

-- 2. DETECTION QUEUE TABLE ----------------------------------------------------
CREATE TABLE IF NOT EXISTS detection_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id TEXT NOT NULL,
    sync_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    priority INTEGER NOT NULL DEFAULT 1,
    payload JSONB,
    is_sandbox BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_detection_queue_seller ON detection_queue(seller_id);
CREATE INDEX IF NOT EXISTS idx_detection_queue_status ON detection_queue(status);
CREATE INDEX IF NOT EXISTS idx_detection_queue_priority ON detection_queue(priority);

COMMENT ON TABLE detection_queue IS 'Queue of Discovery Agent jobs (Agent 2 → Python ML).';

-- 3. DETECTION RESULTS TABLE --------------------------------------------------
CREATE TABLE IF NOT EXISTS detection_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id TEXT NOT NULL,
    sync_id TEXT,
    anomaly_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
    estimated_value NUMERIC(12,2) DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    confidence_score NUMERIC(5,2),
    evidence JSONB DEFAULT '{}'::jsonb,
    related_event_ids TEXT[],
    discovery_date TIMESTAMPTZ,
    deadline_date TIMESTAMPTZ,
    days_remaining INTEGER,
    expired BOOLEAN DEFAULT FALSE,
    expiration_alert_sent BOOLEAN DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, reviewed, disputed, resolved
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detection_results_seller ON detection_results(seller_id);
CREATE INDEX IF NOT EXISTS idx_detection_results_sync ON detection_results(sync_id);
CREATE INDEX IF NOT EXISTS idx_detection_results_status ON detection_results(status);
CREATE INDEX IF NOT EXISTS idx_detection_results_deadline ON detection_results(deadline_date);

COMMENT ON TABLE detection_results IS 'Stores Discovery Agent outputs (claimable discrepancies).';

