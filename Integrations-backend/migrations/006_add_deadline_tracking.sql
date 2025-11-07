-- Migration: Add deadline tracking for claims and detection results
-- This migration adds 60-day deadline tracking for Amazon claims

-- Add deadline tracking columns to detection_results
ALTER TABLE detection_results
  ADD COLUMN IF NOT EXISTS discovery_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deadline_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS days_remaining INTEGER,
  ADD COLUMN IF NOT EXISTS expiration_alert_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expired BOOLEAN DEFAULT FALSE;

-- Add deadline tracking columns to claims table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'claims') THEN
    ALTER TABLE claims
      ADD COLUMN IF NOT EXISTS discovery_date TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS deadline_date TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS days_remaining INTEGER,
      ADD COLUMN IF NOT EXISTS expiration_alert_sent BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS expired BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Create indexes for deadline queries
CREATE INDEX IF NOT EXISTS idx_detection_results_deadline_date ON detection_results(deadline_date) WHERE deadline_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detection_results_days_remaining ON detection_results(days_remaining) WHERE days_remaining IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detection_results_expired ON detection_results(expired) WHERE expired = TRUE;

-- Add function to calculate deadline (60 days from discovery)
CREATE OR REPLACE FUNCTION calculate_claim_deadline(discovery_date TIMESTAMP WITH TIME ZONE)
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
  RETURN discovery_date + INTERVAL '60 days';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add function to calculate days remaining
CREATE OR REPLACE FUNCTION calculate_days_remaining(deadline_date TIMESTAMP WITH TIME ZONE)
RETURNS INTEGER AS $$
BEGIN
  RETURN GREATEST(0, EXTRACT(EPOCH FROM (deadline_date - NOW())) / 86400)::INTEGER;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create view for claims approaching deadline
CREATE OR REPLACE VIEW claims_approaching_deadline AS
SELECT 
  id,
  seller_id,
  anomaly_type,
  severity,
  estimated_value,
  currency,
  status,
  discovery_date,
  deadline_date,
  days_remaining,
  expiration_alert_sent,
  expired,
  created_at
FROM detection_results
WHERE 
  deadline_date IS NOT NULL
  AND expired = FALSE
  AND status IN ('pending', 'reviewed')
  AND days_remaining <= 7  -- 7 days or less remaining
ORDER BY days_remaining ASC, severity DESC;

COMMENT ON VIEW claims_approaching_deadline IS 'Claims with 7 days or less remaining until deadline';

