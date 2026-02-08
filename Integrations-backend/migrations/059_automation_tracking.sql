-- Migration: 059_automation_tracking.sql
-- Adds submission tracking to claims and dispute_cases for Agent 7 automation

-- Update dispute_cases (Primary for Agent 7)
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS amazon_case_id VARCHAR(255);
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS submission_attempts INT DEFAULT 0;
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS last_submission_attempt TIMESTAMP WITH TIME ZONE;
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS evidence_attachments JSONB DEFAULT '[]';

-- Update claims (Frontend Visibility)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS amazon_case_id VARCHAR(255);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS submission_attempts INT DEFAULT 0;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_submission_attempt TIMESTAMP WITH TIME ZONE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS evidence_attachments JSONB DEFAULT '[]';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dispute_cases_amazon_case_id ON dispute_cases(amazon_case_id);
CREATE INDEX IF NOT EXISTS idx_claims_amazon_case_id ON claims(amazon_case_id);
