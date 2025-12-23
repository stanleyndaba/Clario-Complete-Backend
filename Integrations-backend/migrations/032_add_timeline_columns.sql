-- Migration: Add timeline column to detection_results and claims tables
-- Purpose: Store actual event history for claims (filed, status changes, escalations, etc.)

-- Add timeline JSONB column to detection_results
ALTER TABLE detection_results 
ADD COLUMN IF NOT EXISTS timeline JSONB DEFAULT '[]'::jsonb;

-- Add timeline JSONB column to claims
ALTER TABLE claims 
ADD COLUMN IF NOT EXISTS timeline JSONB DEFAULT '[]'::jsonb;

-- Add index for timeline queries (GIN index for JSONB)
CREATE INDEX IF NOT EXISTS idx_detection_results_timeline 
ON detection_results USING GIN (timeline);

CREATE INDEX IF NOT EXISTS idx_claims_timeline 
ON claims USING GIN (timeline);

-- Comments
COMMENT ON COLUMN detection_results.timeline IS 'Array of timeline events: [{id, date, action, description, amount?, rejectionReason?, escalationRound?}]';
COMMENT ON COLUMN claims.timeline IS 'Array of timeline events: [{id, date, action, description, amount?, rejectionReason?, escalationRound?}]';
