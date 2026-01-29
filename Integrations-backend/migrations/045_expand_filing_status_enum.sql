
-- Migration: 045_expand_filing_status_enum.sql
-- Expands the allowed values for dispute_cases.filing_status to support hardening features

-- Drop the old constraint
ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;

-- Add the expanded constraint
ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
  CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed', 'quarantined_dangerous_doc', 'duplicate_blocked', 'already_reimbursed', 'pending_approval'));

-- Add comments for documentation
COMMENT ON COLUMN dispute_cases.filing_status IS 'Status of filing process: pending, filing, filed, retrying, failed, quarantined_dangerous_doc, duplicate_blocked, already_reimbursed, pending_approval';
