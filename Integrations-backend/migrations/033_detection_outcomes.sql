-- Migration: 033_detection_outcomes
-- Phase 3: ML & Pattern Recognition - Outcome Tracking

-- Table to track claim outcomes (approved/rejected/partial)
-- This enables the confidence calibration feedback loop

CREATE TABLE IF NOT EXISTS detection_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_result_id UUID REFERENCES detection_results(id) ON DELETE CASCADE,
  
  -- Original detection info (denormalized for fast queries)
  seller_id UUID NOT NULL,
  anomaly_type TEXT NOT NULL,
  predicted_confidence NUMERIC(4,2) NOT NULL,  -- What we predicted (0.00-1.00)
  estimated_value NUMERIC(12,2) NOT NULL,
  
  -- Actual outcome
  actual_outcome TEXT NOT NULL CHECK (actual_outcome IN ('approved', 'rejected', 'partial', 'pending', 'expired')),
  recovery_amount NUMERIC(12,2) DEFAULT 0,      -- What was actually recovered
  recovery_percentage NUMERIC(5,2),             -- recovery_amount / estimated_value
  
  -- Amazon response
  amazon_case_id TEXT,
  amazon_response_date TIMESTAMPTZ,
  amazon_response_reason TEXT,
  
  -- Timing
  claim_filed_date TIMESTAMPTZ,
  resolution_date TIMESTAMPTZ,
  days_to_resolution INTEGER,
  
  -- Metadata
  filed_by TEXT,  -- 'auto', 'manual', 'agent'
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast ML queries
CREATE INDEX IF NOT EXISTS idx_outcomes_seller ON detection_outcomes(seller_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_anomaly ON detection_outcomes(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON detection_outcomes(actual_outcome);
CREATE INDEX IF NOT EXISTS idx_outcomes_date ON detection_outcomes(created_at);

-- Composite index for accuracy calculations per type
CREATE INDEX IF NOT EXISTS idx_outcomes_type_outcome ON detection_outcomes(anomaly_type, actual_outcome);

-- View for confidence accuracy by anomaly type
CREATE OR REPLACE VIEW anomaly_type_accuracy AS
SELECT 
  anomaly_type,
  COUNT(*) as total_claims,
  COUNT(*) FILTER (WHERE actual_outcome = 'approved') as approved_count,
  COUNT(*) FILTER (WHERE actual_outcome = 'rejected') as rejected_count,
  COUNT(*) FILTER (WHERE actual_outcome = 'partial') as partial_count,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') as pending_count,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome IN ('approved', 'partial'))::NUMERIC / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome != 'pending'), 0) * 100, 
    2
  ) as approval_rate,
  ROUND(AVG(predicted_confidence) * 100, 2) as avg_predicted_confidence,
  ROUND(AVG(recovery_percentage), 2) as avg_recovery_percentage,
  ROUND(AVG(days_to_resolution), 1) as avg_days_to_resolution,
  SUM(recovery_amount) as total_recovered
FROM detection_outcomes
GROUP BY anomaly_type
ORDER BY total_claims DESC;

-- View for seller-level patterns
CREATE OR REPLACE VIEW seller_detection_patterns AS
SELECT 
  seller_id,
  COUNT(*) as total_detections,
  COUNT(DISTINCT anomaly_type) as unique_anomaly_types,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome IN ('approved', 'partial'))::NUMERIC / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome != 'pending'), 0) * 100, 
    2
  ) as overall_approval_rate,
  SUM(recovery_amount) as total_recovered,
  SUM(estimated_value) as total_estimated,
  ROUND(SUM(recovery_amount) / NULLIF(SUM(estimated_value), 0) * 100, 2) as recovery_efficiency,
  MODE() WITHIN GROUP (ORDER BY anomaly_type) as most_common_anomaly
FROM detection_outcomes
GROUP BY seller_id;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_detection_outcomes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  -- Calculate days to resolution if both dates exist
  IF NEW.claim_filed_date IS NOT NULL AND NEW.resolution_date IS NOT NULL THEN
    NEW.days_to_resolution = EXTRACT(DAY FROM NEW.resolution_date - NEW.claim_filed_date);
  END IF;
  -- Calculate recovery percentage
  IF NEW.estimated_value > 0 THEN
    NEW.recovery_percentage = (NEW.recovery_amount / NEW.estimated_value) * 100;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_detection_outcomes_updated
  BEFORE UPDATE ON detection_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION update_detection_outcomes_timestamp();

-- Insert some seed data for testing (mock outcomes)
-- This gives the ML system something to learn from initially

INSERT INTO detection_outcomes (seller_id, anomaly_type, predicted_confidence, estimated_value, actual_outcome, recovery_amount, claim_filed_date, resolution_date)
SELECT 
  gen_random_uuid() as seller_id,
  anomaly_type,
  (0.7 + random() * 0.25)::numeric(4,2) as predicted_confidence,
  (50 + random() * 450)::numeric(12,2) as estimated_value,
  (ARRAY['approved', 'approved', 'approved', 'rejected', 'partial'])[floor(random() * 5 + 1)] as actual_outcome,
  CASE 
    WHEN random() > 0.3 THEN (30 + random() * 400)::numeric(12,2)
    ELSE 0
  END as recovery_amount,
  NOW() - INTERVAL '1 day' * (floor(random() * 90 + 1)),
  NOW() - INTERVAL '1 day' * (floor(random() * 30))
FROM (
  SELECT unnest(ARRAY[
    'lost_warehouse', 'damaged_warehouse', 'refund_no_return',
    'fulfillment_fee_error', 'storage_overcharge', 'commission_overcharge',
    'chargeback', 'atoz_claim', 'shipment_shortage', 'removal_unfulfilled',
    'switcheroo', 'carrier_damage'
  ]) as anomaly_type
) types
CROSS JOIN generate_series(1, 30);  -- 30 samples per type = 360 total
