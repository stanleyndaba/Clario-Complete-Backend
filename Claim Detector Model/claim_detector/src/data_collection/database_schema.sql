-- FBA Claims System Database Schema
-- This creates the foundation for collecting and storing Amazon FBA data

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. SHIPMENTS TABLE - Track all inbound shipments
CREATE TABLE IF NOT EXISTS shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(100) NOT NULL,
    asin VARCHAR(20),
    qty_sent INTEGER NOT NULL,
    qty_received INTEGER,
    shipment_date DATE NOT NULL,
    received_date DATE,
    warehouse_location VARCHAR(50),
    carrier VARCHAR(100),
    tracking_number VARCHAR(100),
    status VARCHAR(50) DEFAULT 'in_transit', -- in_transit, received, lost, damaged
    cost_per_unit DECIMAL(10,2),
    total_cost DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. INVENTORY LEDGER TABLE - Track inventory movements
CREATE TABLE IF NOT EXISTS inventory_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(100) NOT NULL,
    asin VARCHAR(20),
    transaction_type VARCHAR(50) NOT NULL, -- received, lost, damaged, destroyed, returned
    quantity INTEGER NOT NULL,
    transaction_date DATE NOT NULL,
    warehouse_location VARCHAR(50),
    reason_code VARCHAR(100),
    reference_id VARCHAR(100), -- links to shipment or other transaction
    cost_per_unit DECIMAL(10,2),
    total_value DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. REIMBURSEMENTS TABLE - Track Amazon's reimbursement decisions
CREATE TABLE IF NOT EXISTS reimbursements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID REFERENCES claims(id),
    sku VARCHAR(100) NOT NULL,
    asin VARCHAR(20),
    reimbursement_type VARCHAR(50), -- lost_inventory, damaged_goods, fee_overcharge
    amount_requested DECIMAL(10,2) NOT NULL,
    amount_approved DECIMAL(10,2),
    quantity_lost INTEGER,
    reason VARCHAR(500),
    amazon_decision VARCHAR(50), -- approved, partial, denied
    decision_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. CLAIMS TABLE - Track all submitted claims
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(100) NOT NULL,
    asin VARCHAR(20),
    claim_type VARCHAR(50) NOT NULL, -- lost_inventory, damaged_goods, fee_overcharge, etc.
    quantity_affected INTEGER NOT NULL,
    amount_requested DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft', -- draft, submitted, under_review, approved, denied
    submission_date DATE,
    decision_date DATE,
    amazon_case_id VARCHAR(100),
    reasoning TEXT,
    evidence_attached BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. AMAZON RULES TABLE - Store Amazon's current policies
CREATE TABLE IF NOT EXISTS amazon_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_name VARCHAR(200) NOT NULL,
    rule_category VARCHAR(100), -- eligibility, limits, timeframes
    rule_description TEXT NOT NULL,
    rule_condition TEXT NOT NULL, -- JSON or SQL-like condition
    rule_action VARCHAR(50), -- allow, deny, limit, warn
    rule_value DECIMAL(10,2), -- numeric value if applicable
    effective_date DATE NOT NULL,
    expiry_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 1, -- higher number = higher priority
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. MODEL PREDICTIONS TABLE - Store ML model predictions
CREATE TABLE IF NOT EXISTS model_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID REFERENCES claims(id),
    model_version VARCHAR(50) NOT NULL,
    prediction_probability DECIMAL(5,4) NOT NULL, -- 0.0000 to 1.0000
    prediction_class VARCHAR(20) NOT NULL, -- claimable, not_claimable
    confidence_score DECIMAL(5,4),
    feature_importance JSONB, -- store feature importance scores
    rules_applied JSONB, -- store which rules were triggered
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. FEEDBACK LOOP TABLE - Track actual outcomes vs predictions
CREATE TABLE IF NOT EXISTS feedback_loop (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID REFERENCES claims(id),
    prediction_id UUID REFERENCES model_predictions(id),
    actual_outcome VARCHAR(50), -- approved, partial, denied
    actual_amount DECIMAL(10,2),
    outcome_date DATE,
    accuracy_score DECIMAL(5,4), -- how accurate was our prediction
    drift_detected BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. API_LOGS TABLE - Track all API calls for monitoring
CREATE TABLE IF NOT EXISTS api_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL,
    request_data JSONB,
    response_data JSONB,
    status_code INTEGER,
    response_time_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_shipments_sku ON shipments(sku);
CREATE INDEX IF NOT EXISTS idx_shipments_date ON shipments(shipment_date);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_sku ON inventory_ledger(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_date ON inventory_ledger(transaction_date);
CREATE INDEX IF NOT EXISTS idx_claims_sku ON claims(sku);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_amazon_rules_active ON amazon_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_model_predictions_claim ON model_predictions(claim_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables that need updated_at
CREATE TRIGGER update_shipments_updated_at BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reimbursements_updated_at BEFORE UPDATE ON reimbursements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_amazon_rules_updated_at BEFORE UPDATE ON amazon_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert some default Amazon rules
INSERT INTO amazon_rules (rule_name, rule_category, rule_description, rule_condition, rule_action, rule_value, effective_date, priority) VALUES
('18 Month Rule', 'eligibility', 'Items older than 18 months are ineligible for reimbursement', '{"field": "days_since_shipment", "operator": ">", "value": 547}', 'deny', NULL, CURRENT_DATE, 1),
('Max Claim Limit', 'limits', 'Maximum claim cannot exceed item cost × quantity lost', '{"field": "amount_requested", "operator": ">", "value": "cost_per_unit * quantity_lost"}', 'limit', NULL, CURRENT_DATE, 2),
('Minimum Claim Amount', 'eligibility', 'Claims under $5 are not eligible', '{"field": "amount_requested", "operator": "<", "value": 5.00}', 'deny', 5.00, CURRENT_DATE, 3),
('Lost Inventory Timeframe', 'timeframes', 'Lost inventory claims must be filed within 9 months', '{"field": "days_since_shipment", "operator": ">", "value": 270}', 'deny', NULL, CURRENT_DATE, 4),
('Damaged Goods Evidence', 'eligibility', 'Damaged goods claims require photographic evidence', '{"field": "claim_type", "operator": "=", "value": "damaged_goods", "and": {"field": "evidence_attached", "operator": "=", "value": false}}', 'deny', NULL, CURRENT_DATE, 5);

-- Create view for easy claim analysis
CREATE OR REPLACE VIEW claim_analysis AS
SELECT 
    c.id as claim_id,
    c.sku,
    c.claim_type,
    c.quantity_affected,
    c.amount_requested,
    c.status,
    c.submission_date,
    c.decision_date,
    mp.prediction_probability,
    mp.prediction_class,
    mp.confidence_score,
    r.amount_approved,
    r.amazon_decision,
    CASE 
        WHEN c.submission_date IS NOT NULL THEN 
            EXTRACT(DAYS FROM (CURRENT_DATE - c.submission_date))
        ELSE NULL 
    END as days_since_submission
FROM claims c
LEFT JOIN model_predictions mp ON c.id = mp.claim_id
LEFT JOIN reimbursements r ON c.id = r.claim_id
ORDER BY c.created_at DESC;

