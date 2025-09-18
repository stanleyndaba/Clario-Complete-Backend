-- Claims Feedback Schema for Concierge Feedback Loop
-- This table stores real-world Amazon claim outcomes to enable continuous learning

CREATE TABLE IF NOT EXISTS claims_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id VARCHAR(255) NOT NULL,  -- Original claim identifier
    claim_type VARCHAR(100) NOT NULL, -- lost, damaged, fee, overcharge, etc.
    claim_text TEXT NOT NULL,        -- Original claim description
    claim_amount DECIMAL(10,2),      -- Claimed amount
    claim_currency VARCHAR(3) DEFAULT 'USD',
    
    -- Model Prediction Data
    model_prediction BOOLEAN,        -- What our model predicted (true=claimable)
    model_confidence DECIMAL(5,4),   -- Model confidence score (0.0000-1.0000)
    model_features JSONB,            -- Features used for prediction
    
    -- Amazon's Decision
    amazon_status VARCHAR(20) NOT NULL DEFAULT 'submitted', -- submitted, accepted, rejected, partial
    amazon_decision_date TIMESTAMP,
    amazon_rejection_reason TEXT,    -- Why Amazon rejected (if applicable)
    amazon_final_amount DECIMAL(10,2), -- Final amount Amazon approved
    amazon_notes TEXT,               -- Any additional Amazon feedback
    
    -- Concierge Oversight
    concierge_reviewed BOOLEAN DEFAULT FALSE,
    concierge_notes TEXT,            -- Human reviewer notes
    edge_case_tag VARCHAR(100),      -- Flag for unusual cases requiring review
    retraining_priority INTEGER DEFAULT 1, -- 1=low, 5=critical for retraining
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    amazon_rule_version VARCHAR(50), -- Track which Amazon policy version applied
    
    -- Indexes for performance
    CONSTRAINT valid_status CHECK (amazon_status IN ('submitted', 'accepted', 'rejected', 'partial')),
    CONSTRAINT valid_priority CHECK (retraining_priority BETWEEN 1 AND 5)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_claims_feedback_claim_id ON claims_feedback(claim_id);
CREATE INDEX IF NOT EXISTS idx_claims_feedback_status ON claims_feedback(amazon_status);
CREATE INDEX IF NOT EXISTS idx_claims_feedback_type ON claims_feedback(claim_type);
CREATE INDEX IF NOT EXISTS idx_claims_feedback_priority ON claims_feedback(retraining_priority);
CREATE INDEX IF NOT EXISTS idx_claims_feedback_created_at ON claims_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_claims_feedback_edge_case ON claims_feedback(edge_case_tag);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_claims_feedback_updated_at 
    BEFORE UPDATE ON claims_feedback 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for easy access to training-ready data
CREATE OR REPLACE VIEW claims_training_data AS
SELECT 
    id,
    claim_id,
    claim_type,
    claim_text,
    claim_amount,
    model_prediction,
    model_confidence,
    amazon_status,
    amazon_final_amount,
    amazon_rejection_reason,
    edge_case_tag,
    retraining_priority,
    created_at,
    -- Create binary label for training: accepted = valid (1), rejected = invalid (0)
    CASE 
        WHEN amazon_status = 'accepted' THEN 1
        WHEN amazon_status = 'rejected' THEN 0
        WHEN amazon_status = 'partial' THEN 1  -- Partial acceptance still counts as valid
        ELSE NULL  -- submitted status has no outcome yet
    END as training_label,
    -- Create confidence score for training
    CASE 
        WHEN amazon_status = 'accepted' THEN 1.0
        WHEN amazon_status = 'rejected' THEN 0.0
        WHEN amazon_status = 'partial' THEN 0.7  -- Partial acceptance gets lower confidence
        ELSE NULL
    END as training_confidence
FROM claims_feedback 
WHERE amazon_status IN ('accepted', 'rejected', 'partial')
  AND edge_case_tag IS NOT NULL;  -- Only include reviewed cases

-- Insert sample data for testing
INSERT INTO claims_feedback (
    claim_id, claim_type, claim_text, claim_amount, 
    model_prediction, model_confidence, amazon_status, 
    amazon_final_amount, amazon_rejection_reason, 
    edge_case_tag, retraining_priority
) VALUES 
    ('SAMPLE-001', 'lost', 'Amazon warehouse lost 5 units during transfer', 150.00, 
     true, 0.95, 'accepted', 150.00, NULL, 'standard_claim', 1),
    
    ('SAMPLE-002', 'damaged', 'Product arrived with broken packaging', 75.50, 
     true, 0.87, 'rejected', 0.00, 'Insufficient evidence of damage', 'edge_case', 4),
    
    ('SAMPLE-003', 'fee', 'Incorrect FBA storage fee charged', 25.00, 
     true, 0.92, 'accepted', 25.00, NULL, 'standard_claim', 1),
    
    ('SAMPLE-004', 'overcharge', 'Double charged for shipping', 12.99, 
     false, 0.15, 'accepted', 12.99, NULL, 'model_miss', 5);

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE ON claims_feedback TO your_app_user;
-- GRANT SELECT ON claims_training_data TO your_app_user;
