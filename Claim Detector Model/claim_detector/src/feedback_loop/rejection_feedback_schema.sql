-- Enhanced Rejection Feedback Schema for Concierge Feedback Update System
-- Tracks every Amazon rejection and transforms it into actionable intelligence

-- Main rejection tracking table
CREATE TABLE IF NOT EXISTS claim_rejections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id VARCHAR(255) NOT NULL,  -- Original claim identifier
    sku VARCHAR(100),                -- Product SKU
    asin VARCHAR(20),                -- Amazon ASIN
    claim_type VARCHAR(100) NOT NULL, -- lost, damaged, fee, overcharge, etc.
    claim_amount DECIMAL(10,2),      -- Original claim amount
    claim_text TEXT NOT NULL,        -- Original claim description
    
    -- Amazon's Rejection Details
    amazon_rejection_reason TEXT NOT NULL, -- Exact Amazon rejection text
    rejection_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    amazon_case_id VARCHAR(100),     -- Amazon's internal case ID
    amazon_rule_version VARCHAR(50), -- Amazon policy version at time of rejection
    
    -- Normalized Analysis
    normalized_reason VARCHAR(100),  -- Standardized reason category
    reason_category VARCHAR(50),     -- High-level category (policy, documentation, timing, etc.)
    confidence_score DECIMAL(3,2),   -- Confidence in normalization (0.00-1.00)
    
    -- Feedback Tagging
    feedback_tag VARCHAR(50) NOT NULL, -- 'fixable' or 'unclaimable'
    fixable_reason TEXT,             -- Specific reason if fixable
    unclaimable_reason TEXT,         -- Specific reason if unclaimable
    action_required VARCHAR(100),    -- What action to take
    
    -- Model Performance Data
    model_prediction BOOLEAN,        -- What our model predicted
    model_confidence DECIMAL(5,4),   -- Model's confidence score
    model_features JSONB,            -- Features used for prediction
    
    -- Concierge Analysis
    concierge_notes TEXT,            -- Human reviewer analysis
    priority_level INTEGER DEFAULT 3, -- 1=low, 5=critical
    reviewed_by VARCHAR(100),        -- Who reviewed this rejection
    reviewed_at TIMESTAMP,
    
    -- Feedback Loop Status
    rule_engine_updated BOOLEAN DEFAULT FALSE,
    model_retrained BOOLEAN DEFAULT FALSE,
    knowledge_base_updated BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_feedback_tag CHECK (feedback_tag IN ('fixable', 'unclaimable')),
    CONSTRAINT valid_priority CHECK (priority_level BETWEEN 1 AND 5),
    CONSTRAINT valid_confidence CHECK (confidence_score BETWEEN 0.00 AND 1.00)
);

-- Normalized reason mapping table
CREATE TABLE IF NOT EXISTS rejection_reason_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amazon_text_pattern TEXT NOT NULL, -- Pattern to match in Amazon's text
    normalized_reason VARCHAR(100) NOT NULL, -- Standardized reason
    reason_category VARCHAR(50) NOT NULL, -- High-level category
    feedback_tag VARCHAR(50) NOT NULL, -- Default tag for this reason
    priority_level INTEGER DEFAULT 3,
    action_required VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_mapping_tag CHECK (feedback_tag IN ('fixable', 'unclaimable'))
);

-- Knowledge base for successful claim templates
CREATE TABLE IF NOT EXISTS claim_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name VARCHAR(200) NOT NULL,
    claim_type VARCHAR(100) NOT NULL,
    template_text TEXT NOT NULL, -- Successful claim template
    required_evidence TEXT[], -- Array of required evidence types
    success_rate DECIMAL(5,4), -- Historical success rate
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Edge cases and exceptions
CREATE TABLE IF NOT EXISTS claim_edge_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edge_case_name VARCHAR(200) NOT NULL,
    claim_type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    special_requirements TEXT,
    success_patterns TEXT[], -- Array of successful patterns
    failure_patterns TEXT[], -- Array of failure patterns
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Rule engine updates log
CREATE TABLE IF NOT EXISTS rule_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name VARCHAR(200) NOT NULL,
    rule_type VARCHAR(50) NOT NULL, -- 'block', 'require', 'adjust'
    old_value TEXT,
    new_value TEXT,
    trigger_rejection_id UUID REFERENCES claim_rejections(id),
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT TRUE,
    notes TEXT
);

-- Model retraining log
CREATE TABLE IF NOT EXISTS model_retraining_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retraining_trigger VARCHAR(100), -- What triggered retraining
    rejection_count INTEGER, -- Number of rejections that triggered retraining
    old_accuracy DECIMAL(5,4),
    new_accuracy DECIMAL(5,4),
    improvement DECIMAL(5,4),
    features_added TEXT[], -- New features added
    features_removed TEXT[], -- Features removed
    training_samples INTEGER,
    retrained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    model_version VARCHAR(50)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rejections_claim_id ON claim_rejections(claim_id);
CREATE INDEX IF NOT EXISTS idx_rejections_asin ON claim_rejections(asin);
CREATE INDEX IF NOT EXISTS idx_rejections_type ON claim_rejections(claim_type);
CREATE INDEX IF NOT EXISTS idx_rejections_date ON claim_rejections(rejection_date);
CREATE INDEX IF NOT EXISTS idx_rejections_tag ON claim_rejections(feedback_tag);
CREATE INDEX IF NOT EXISTS idx_rejections_normalized ON claim_rejections(normalized_reason);
CREATE INDEX IF NOT EXISTS idx_rejections_priority ON claim_rejections(priority_level);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_rejections_updated_at 
    BEFORE UPDATE ON claim_rejections 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mapping_updated_at 
    BEFORE UPDATE ON rejection_reason_mapping 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for easy access
CREATE OR REPLACE VIEW rejection_analytics AS
SELECT 
    normalized_reason,
    reason_category,
    feedback_tag,
    COUNT(*) as rejection_count,
    AVG(priority_level) as avg_priority,
    COUNT(CASE WHEN model_prediction = TRUE THEN 1 END) as model_misses,
    COUNT(CASE WHEN rule_engine_updated = TRUE THEN 1 END) as rules_updated,
    COUNT(CASE WHEN model_retrained = TRUE THEN 1 END) as model_retrained
FROM claim_rejections 
GROUP BY normalized_reason, reason_category, feedback_tag
ORDER BY rejection_count DESC;

CREATE OR REPLACE VIEW fixable_rejections AS
SELECT 
    claim_id,
    sku,
    asin,
    claim_type,
    amazon_rejection_reason,
    normalized_reason,
    fixable_reason,
    action_required,
    priority_level,
    rejection_date
FROM claim_rejections 
WHERE feedback_tag = 'fixable'
ORDER BY priority_level DESC, rejection_date DESC;

CREATE OR REPLACE VIEW unclaimable_patterns AS
SELECT 
    normalized_reason,
    reason_category,
    COUNT(*) as pattern_count,
    STRING_AGG(DISTINCT amazon_rejection_reason, ' | ') as example_reasons,
    MAX(rejection_date) as latest_occurrence
FROM claim_rejections 
WHERE feedback_tag = 'unclaimable'
GROUP BY normalized_reason, reason_category
ORDER BY pattern_count DESC;

-- Insert default reason mappings
INSERT INTO rejection_reason_mapping (
    amazon_text_pattern, normalized_reason, reason_category, feedback_tag, priority_level, action_required
) VALUES 
    -- Documentation Issues (Fixable)
    ('insufficient evidence', 'Documentation Missing', 'documentation', 'fixable', 4, 'Add evidence requirements to claim template'),
    ('photos required', 'Documentation Missing', 'documentation', 'fixable', 4, 'Add photo requirements to claim template'),
    ('missing documentation', 'Documentation Missing', 'documentation', 'fixable', 4, 'Update claim template with required docs'),
    
    -- Policy Issues (Unclaimable)
    ('policy not claimable', 'Policy Restriction', 'policy', 'unclaimable', 5, 'Add policy rule to block similar claims'),
    ('not eligible for reimbursement', 'Policy Restriction', 'policy', 'unclaimable', 5, 'Update rules to prevent filing'),
    ('outside of policy', 'Policy Restriction', 'policy', 'unclaimable', 5, 'Add policy check to claim validation'),
    
    -- Timing Issues (Unclaimable)
    ('timeframe expired', 'Time Limit Exceeded', 'timing', 'unclaimable', 3, 'Add time limit validation'),
    ('past deadline', 'Time Limit Exceeded', 'timing', 'unclaimable', 3, 'Update claim window rules'),
    ('too old', 'Time Limit Exceeded', 'timing', 'unclaimable', 3, 'Add age validation to claims'),
    
    -- Format Issues (Fixable)
    ('incorrect format', 'Format Error', 'format', 'fixable', 3, 'Update claim submission format'),
    ('wrong format', 'Format Error', 'format', 'fixable', 3, 'Fix claim template formatting'),
    ('invalid format', 'Format Error', 'format', 'fixable', 3, 'Update validation rules'),
    
    -- Amount Issues (Fixable)
    ('amount incorrect', 'Amount Error', 'calculation', 'fixable', 3, 'Add amount validation logic'),
    ('wrong amount', 'Amount Error', 'calculation', 'fixable', 3, 'Update calculation rules'),
    ('overcharged', 'Amount Error', 'calculation', 'fixable', 3, 'Add amount verification'),
    
    -- Evidence Issues (Fixable)
    ('evidence insufficient', 'Evidence Insufficient', 'evidence', 'fixable', 4, 'Add evidence quality checks'),
    ('better evidence needed', 'Evidence Insufficient', 'evidence', 'fixable', 4, 'Update evidence requirements'),
    ('more evidence required', 'Evidence Insufficient', 'evidence', 'fixable', 4, 'Enhance evidence validation');

-- Insert sample successful templates
INSERT INTO claim_templates (
    template_name, claim_type, template_text, required_evidence, success_rate
) VALUES 
    ('Lost Inventory Standard', 'lost', 
     'Amazon warehouse lost {quantity} units of ASIN {asin} during transfer on {date}. Requesting reimbursement for ${amount}.',
     ARRAY['inventory report', 'transfer documentation'], 0.95),
    
    ('Damaged Goods with Photos', 'damaged',
     'Product arrived damaged with broken packaging. Order {order_id}. Photos attached showing damage. Requesting refund of ${amount}.',
     ARRAY['damage photos', 'packaging photos', 'order confirmation'], 0.88),
    
    ('Fee Discrepancy', 'fee',
     'Incorrect FBA storage fee charged for {period}. Should be ${correct_amount}, charged ${charged_amount}. Requesting correction.',
     ARRAY['fee report', 'billing statement'], 0.92);

-- Insert sample edge cases
INSERT INTO claim_edge_cases (
    edge_case_name, claim_type, description, special_requirements, success_patterns, failure_patterns
) VALUES 
    ('High-Value Electronics', 'damaged',
     'High-value electronics require additional evidence and specific packaging documentation',
     'Original packaging photos, serial number documentation, value verification',
     ARRAY['serial number included', 'original packaging shown', 'value documentation'],
     ARRAY['no serial number', 'generic packaging', 'no value proof']),
    
    ('Seasonal Items', 'lost',
     'Seasonal items have different claim windows and requirements',
     'Seasonal timing validation, special documentation for seasonal items',
     ARRAY['within seasonal window', 'seasonal documentation', 'timely filing'],
     ARRAY['outside seasonal window', 'missing seasonal docs', 'delayed filing']),
    
    ('International Shipments', 'damaged',
     'International shipments require customs documentation and special handling evidence',
     'Customs documentation, international shipping labels, handling instructions',
     ARRAY['customs docs included', 'international labels', 'handling evidence'],
     ARRAY['no customs docs', 'domestic labels only', 'no handling proof']);

-- Grant permissions
-- GRANT SELECT, INSERT, UPDATE ON claim_rejections TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON rejection_reason_mapping TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON claim_templates TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON claim_edge_cases TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON rule_updates TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON model_retraining_log TO your_app_user;
-- GRANT SELECT ON rejection_analytics TO your_app_user;
-- GRANT SELECT ON fixable_rejections TO your_app_user;
-- GRANT SELECT ON unclaimable_patterns TO your_app_user;


