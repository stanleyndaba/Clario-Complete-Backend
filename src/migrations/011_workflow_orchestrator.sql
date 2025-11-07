-- Workflow Orchestrator Migration
-- Adds tables for tracking workflow state and payout monitoring

-- Payout monitoring table (Phase 5)
CREATE TABLE IF NOT EXISTS payout_monitoring (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_id VARCHAR(255) NOT NULL,
    amazon_case_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'monitoring',
    amount DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    platform_fee DECIMAL(10,2),
    seller_payout DECIMAL(10,2),
    payout_date TIMESTAMP WITH TIME ZONE,
    proof_packet_id UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_payout_monitoring_user_id ON payout_monitoring(user_id);
CREATE INDEX IF NOT EXISTS idx_payout_monitoring_status ON payout_monitoring(status);
CREATE INDEX IF NOT EXISTS idx_payout_monitoring_claim_id ON payout_monitoring(claim_id);

-- Note: sync_jobs, detection_jobs, and claims tables may already exist
-- These are created only if they don't exist (using IF NOT EXISTS)
-- The existing sync_progress table is used for workflow tracking

-- Sync jobs table - only if doesn't exist (may already exist in other migrations)
CREATE TABLE IF NOT EXISTS sync_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    orders_count INTEGER DEFAULT 0,
    inventory_items INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_user_id ON sync_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);

-- Detection jobs table - only if doesn't exist
CREATE TABLE IF NOT EXISTS detection_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sync_id UUID,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    claims_found INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_detection_jobs_user_id ON detection_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_detection_jobs_status ON detection_jobs(status);
CREATE INDEX IF NOT EXISTS idx_detection_jobs_sync_id ON detection_jobs(sync_id);

-- Note: claims table already exists in 002_postgresql_init.sql
-- This migration only ensures it exists with these specific columns
-- If claims table exists with different schema, it won't be modified

