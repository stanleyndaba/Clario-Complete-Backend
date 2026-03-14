-- Migration: 067_agent7_hardening_v2.sql
-- Description: Hardening Agent 7 with atomic state transitions and idempotency keys.
-- Adds 'submitting' and 'recovering' states to filing_status and adds the idempotency_key column.

BEGIN;

-- 1. Expand filing_status constraint in dispute_cases
-- We drop the old constraint and add the new one with 'submitting' and 'recovering'
ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;

ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
  CHECK (filing_status IN (
    'pending', 
    'filing', 
    'submitting', -- NEW: Atomic lock state
    'recovering', -- NEW: Crash recovery state
    'filed', 
    'retrying', 
    'failed', 
    'quarantined_dangerous_doc', 
    'duplicate_blocked', 
    'already_reimbursed', 
    'pending_approval'
  ));

-- Update documentation comment
COMMENT ON COLUMN dispute_cases.filing_status IS 'Status of filing process: pending, filing, submitting, recovering, filed, retrying, failed, quarantined_dangerous_doc, duplicate_blocked, already_reimbursed, pending_approval';

-- 2. Add idempotency_key column to dispute_cases
-- We use TEXT for the hash and ensure it is UNIQUE to prevent duplicate Amazon submissions.
-- Postgres allows multiple NULLs in a UNIQUE column, so existing rows will not conflict.
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Generate unique index for idempotency_key (enforces atomicity at the DB level)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_cases_idempotency_key ON dispute_cases(idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMIT;
