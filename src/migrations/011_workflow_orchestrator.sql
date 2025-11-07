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

-- Sync jobs table (if not exists)
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

-- Detection jobs table (if not exists)
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

-- Claims table (if not exists) - simplified version
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_id VARCHAR(255) NOT NULL UNIQUE,
    claim_type VARCHAR(100),
    amount DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    amazon_case_id VARCHAR(255),
    confidence DECIMAL(5,4),
    evidence JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_user_id ON claims(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_claim_id ON claims(claim_id);

