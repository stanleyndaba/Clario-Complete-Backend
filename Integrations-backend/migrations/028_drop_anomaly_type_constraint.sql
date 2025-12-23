-- Migration: Drop restrictive anomaly_type check constraint
-- Purpose: Allow all 64+ Amazon FBA claim types instead of just 5
-- The detection system uses types like: fulfillment_fee_error, weight_fee_overcharge, 
-- lost_warehouse, damaged_warehouse, carrier_claim, refund_no_return, storage_overcharge, etc.

-- Drop the old restrictive constraint
ALTER TABLE detection_results DROP CONSTRAINT IF EXISTS detection_results_anomaly_type_check;

-- Add a comment explaining why we don't use a CHECK constraint here
COMMENT ON COLUMN detection_results.anomaly_type IS 'Type of detected anomaly - accepts any text value to support 64+ Amazon FBA claim types';
