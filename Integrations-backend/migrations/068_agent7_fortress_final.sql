/** 
 * Agent 7: Production Fortress Migration
 * Includes State Machine Expansion, Idempotency Guard, and Identity Mapping.
 */

BEGIN;

-- 1. Expand State Machine enum/constraint
-- We add 'submitting', 'payment_required', and 'failed'
-- Handling both Postgres ENUM and CHECK constraint scenarios for maximum compatibility.

DO $$ 
BEGIN
    -- If it's an ENUM type
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'filing_status_type') THEN
        ALTER TYPE filing_status_type ADD VALUE IF NOT EXISTS 'submitting';
        ALTER TYPE filing_status_type ADD VALUE IF NOT EXISTS 'payment_required';
        ALTER TYPE filing_status_type ADD VALUE IF NOT EXISTS 'failed';
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Drop and recreate the CHECK constraint for table-level safety
ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;
ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
  CHECK (filing_status IN (
    'pending', 
    'filing', 
    'submitting',        -- NEW: Atomic lock state
    'recovering', 
    'payment_required', -- NEW: Zero-Trust Financial Gate
    'filed', 
    'retrying', 
    'failed', 
    'quarantined_dangerous_doc', 
    'duplicate_blocked', 
    'already_reimbursed', 
    'pending_approval'
  ));

-- 2. Ensure Idempotency Lock
-- Ensures we never submit the same claim twice to Amazon SP-API.
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_cases_idempotency_key 
ON dispute_cases(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 3. The Relational Sync (V1 Seller Identity Bridge)
-- Maps the Amazon Merchant Token (sellerId) to our internal SHA256 hashed userId.
CREATE TABLE IF NOT EXISTS v1_seller_identity_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merchant_token TEXT NOT NULL UNIQUE, -- The Amazon SellerId
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Revenue Readiness: Flag paying beta users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_paid_beta BOOLEAN DEFAULT FALSE;

-- Enable RLS for Security
ALTER TABLE v1_seller_identity_map ENABLE ROW LEVEL SECURITY;

-- Index for fast lookup during worker Pre-Flight Sentry
CREATE INDEX IF NOT EXISTS idx_seller_identity_merchant_token ON v1_seller_identity_map(merchant_token);

COMMIT;
