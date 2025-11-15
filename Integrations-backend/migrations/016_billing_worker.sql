-- Migration: Add Billing Worker Support (Agent 9)
-- Adds billing tracking, transactions, and error logging

-- Create billing_transactions table
CREATE TABLE IF NOT EXISTS billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  recovery_id UUID REFERENCES recoveries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  amount_recovered_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  seller_payout_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  stripe_transaction_id INTEGER, -- FK to stripe-payments StripeTransaction (optional, may be in different DB)
  stripe_payment_intent_id TEXT,
  billing_status TEXT NOT NULL CHECK (billing_status IN ('pending', 'charged', 'failed', 'refunded')),
  idempotency_key TEXT UNIQUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for billing_transactions
CREATE INDEX IF NOT EXISTS idx_billing_transactions_dispute_id ON billing_transactions(dispute_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_recovery_id ON billing_transactions(recovery_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_user_id ON billing_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_billing_status ON billing_transactions(billing_status);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_idempotency_key ON billing_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_created_at ON billing_transactions(created_at);

-- Create billing_errors table
CREATE TABLE IF NOT EXISTS billing_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  recovery_id UUID REFERENCES recoveries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT FALSE
);

-- Create indexes for billing_errors
CREATE INDEX IF NOT EXISTS idx_billing_errors_dispute_id ON billing_errors(dispute_id);
CREATE INDEX IF NOT EXISTS idx_billing_errors_recovery_id ON billing_errors(recovery_id);
CREATE INDEX IF NOT EXISTS idx_billing_errors_user_id ON billing_errors(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_errors_error_type ON billing_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_billing_errors_resolved ON billing_errors(resolved);
CREATE INDEX IF NOT EXISTS idx_billing_errors_created_at ON billing_errors(created_at);

-- Add billing columns to dispute_cases table
DO $$ 
BEGIN
  -- Add billing_status column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'billing_status'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN billing_status TEXT CHECK (billing_status IN ('pending', 'charged', 'failed', 'refunded'));
  END IF;

  -- Add billing_transaction_id column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'billing_transaction_id'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN billing_transaction_id UUID REFERENCES billing_transactions(id) ON DELETE SET NULL;
  END IF;

  -- Add platform_fee_cents column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'platform_fee_cents'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN platform_fee_cents INTEGER;
  END IF;

  -- Add seller_payout_cents column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'seller_payout_cents'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN seller_payout_cents INTEGER;
  END IF;

  -- Add billed_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'billed_at'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN billed_at TIMESTAMPTZ;
  END IF;

  -- Add billing_retry_count column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'billing_retry_count'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN billing_retry_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create indexes for new columns on dispute_cases
CREATE INDEX IF NOT EXISTS idx_dispute_cases_billing_status ON dispute_cases(billing_status);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_billing_transaction_id ON dispute_cases(billing_transaction_id);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_billed_at ON dispute_cases(billed_at);

-- Add RLS policies for billing_transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'billing_transactions' 
    AND policyname = 'billing_transactions_owner_select'
  ) THEN
    CREATE POLICY billing_transactions_owner_select ON billing_transactions
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'billing_transactions' 
    AND policyname = 'billing_transactions_service_role_all'
  ) THEN
    CREATE POLICY billing_transactions_service_role_all ON billing_transactions
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Add RLS policies for billing_errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'billing_errors' 
    AND policyname = 'billing_errors_owner_select'
  ) THEN
    CREATE POLICY billing_errors_owner_select ON billing_errors
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'billing_errors' 
    AND policyname = 'billing_errors_service_role_all'
  ) THEN
    CREATE POLICY billing_errors_service_role_all ON billing_errors
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Enable RLS on billing_transactions
ALTER TABLE billing_transactions ENABLE ROW LEVEL SECURITY;

-- Enable RLS on billing_errors
ALTER TABLE billing_errors ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON TABLE billing_transactions IS 'Tracks all billing transactions for recovered amounts';
COMMENT ON TABLE billing_errors IS 'Logs billing errors and retry attempts';
COMMENT ON COLUMN dispute_cases.billing_status IS 'Status of billing: pending, charged, failed, refunded';
COMMENT ON COLUMN dispute_cases.billing_transaction_id IS 'Reference to billing_transactions table';
COMMENT ON COLUMN dispute_cases.platform_fee_cents IS 'Platform fee (20%) in cents';
COMMENT ON COLUMN dispute_cases.seller_payout_cents IS 'Seller payout (80%) in cents';
COMMENT ON COLUMN dispute_cases.billed_at IS 'Timestamp when billing occurred';
COMMENT ON COLUMN dispute_cases.billing_retry_count IS 'Number of billing retry attempts';

