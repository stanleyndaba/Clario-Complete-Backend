-- Migration: Add claim calculations table for Smart Inventory Sync + Claim Detector integration
-- This table stores the results of automatic claim detection triggered by inventory discrepancies

CREATE TABLE IF NOT EXISTS claim_calculations (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    discrepancy_id VARCHAR(36) NOT NULL,
    claim_type VARCHAR(50) NOT NULL CHECK (claim_type IN ('missing_units', 'overcharge', 'damage', 'delayed_shipment', 'other')),
    claim_amount DECIMAL(12, 4) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    confidence DECIMAL(5, 4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'submitted', 'approved', 'rejected')),
    estimated_payout_time TIMESTAMP WITH TIME ZONE,
    evidence JSONB NOT NULL DEFAULT '{}',
    risk_assessment JSONB NOT NULL DEFAULT '{}',
    audit_trail JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_claim_calculations_user_id ON claim_calculations(user_id);
CREATE INDEX IF NOT EXISTS idx_claim_calculations_sku ON claim_calculations(sku);
CREATE INDEX IF NOT EXISTS idx_claim_calculations_discrepancy_id ON claim_calculations(discrepancy_id);
CREATE INDEX IF NOT EXISTS idx_claim_calculations_status ON claim_calculations(status);
CREATE INDEX IF NOT EXISTS idx_claim_calculations_claim_type ON claim_calculations(claim_type);
CREATE INDEX IF NOT EXISTS idx_claim_calculations_created_at ON claim_calculations(created_at);
CREATE INDEX IF NOT EXISTS idx_claim_calculations_user_status ON claim_calculations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_claim_calculations_user_sku ON claim_calculations(user_id, sku);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_claim_calculations_user_created ON claim_calculations(user_id, created_at DESC);

-- Add foreign key constraints if the tables exist
DO $$
BEGIN
    -- Add foreign key to users table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        ALTER TABLE claim_calculations 
        ADD CONSTRAINT fk_claim_calculations_user_id 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
    
    -- Add foreign key to discrepancies table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'discrepancies') THEN
        ALTER TABLE claim_calculations 
        ADD CONSTRAINT fk_claim_calculations_discrepancy_id 
        FOREIGN KEY (discrepancy_id) REFERENCES discrepancies(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add comments for documentation
COMMENT ON TABLE claim_calculations IS 'Stores automatic claim calculations triggered by inventory discrepancies';
COMMENT ON COLUMN claim_calculations.id IS 'Unique identifier for the claim calculation';
COMMENT ON COLUMN claim_calculations.user_id IS 'User ID who owns this claim';
COMMENT ON COLUMN claim_calculations.sku IS 'SKU associated with the claim';
COMMENT ON COLUMN claim_calculations.discrepancy_id IS 'ID of the discrepancy that triggered this claim';
COMMENT ON COLUMN claim_calculations.claim_type IS 'Type of claim (missing_units, overcharge, damage, delayed_shipment, other)';
COMMENT ON COLUMN claim_calculations.claim_amount IS 'Calculated claim amount in the specified currency';
COMMENT ON COLUMN claim_calculations.currency IS 'Currency code for the claim amount';
COMMENT ON COLUMN claim_calculations.confidence IS 'Confidence score (0-1) for the claim calculation';
COMMENT ON COLUMN claim_calculations.status IS 'Current status of the claim';
COMMENT ON COLUMN claim_calculations.estimated_payout_time IS 'Estimated time when payout will be received';
COMMENT ON COLUMN claim_calculations.evidence IS 'JSON object containing all evidence and proof for the claim';
COMMENT ON COLUMN claim_calculations.risk_assessment IS 'JSON object containing risk analysis and mitigation steps';
COMMENT ON COLUMN claim_calculations.audit_trail IS 'JSON object containing creation, processing, and update timestamps';
COMMENT ON COLUMN claim_calculations.created_at IS 'Timestamp when the claim calculation was created';
COMMENT ON COLUMN claim_calculations.updated_at IS 'Timestamp when the claim calculation was last updated';

-- Create a view for easy claim summary queries
CREATE OR REPLACE VIEW claim_summary_view AS
SELECT 
    user_id,
    COUNT(*) as total_claims,
    SUM(claim_amount) as total_potential_recovery,
    AVG(confidence) as average_confidence,
    COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_claims,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_claims,
    COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_claims,
    SUM(CASE WHEN status = 'approved' THEN claim_amount ELSE 0 END) as estimated_total_payout,
    MAX(created_at) as last_claim_date
FROM claim_calculations
GROUP BY user_id;

-- Create a view for claim type analysis
CREATE OR REPLACE VIEW claim_type_analysis_view AS
SELECT 
    user_id,
    claim_type,
    COUNT(*) as claim_count,
    SUM(claim_amount) as total_amount,
    AVG(confidence) as average_confidence,
    AVG(EXTRACT(EPOCH FROM (estimated_payout_time - created_at)) / 86400) as avg_days_to_payout
FROM claim_calculations
WHERE estimated_payout_time IS NOT NULL
GROUP BY user_id, claim_type;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON claim_calculations TO your_app_user;
-- GRANT SELECT ON claim_summary_view TO your_app_user;
-- GRANT SELECT ON claim_type_analysis_view TO your_app_user;

