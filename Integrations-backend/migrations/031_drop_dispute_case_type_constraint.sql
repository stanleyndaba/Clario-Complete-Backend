-- Migration: Drop restrictive case_type check constraint on dispute_cases
-- Purpose: Allow all 64+ Amazon FBA claim types instead of limited enum values
-- This is the same issue we fixed for detection_results (anomaly_type) and claims (claim_type)

-- Drop the old restrictive constraint
ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_case_type_check;

-- Change to text type to allow any value
ALTER TABLE dispute_cases ALTER COLUMN case_type TYPE TEXT;

-- Add comment
COMMENT ON COLUMN dispute_cases.case_type IS 'Type of dispute case - accepts any text value to support 64+ Amazon FBA claim types';
