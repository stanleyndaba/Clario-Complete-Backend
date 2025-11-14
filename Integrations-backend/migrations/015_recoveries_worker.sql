-- Migration: Add Recoveries Worker Support (Agent 8)
-- Adds recovery tracking, reconciliation, and lifecycle logging

-- Create recoveries table
CREATE TABLE IF NOT EXISTS recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  amazon_case_id TEXT,
  expected_amount DECIMAL(10,2) NOT NULL,
  actual_amount DECIMAL(10,2),
  discrepancy DECIMAL(10,2),
  discrepancy_type TEXT CHECK (discrepancy_type IN ('underpaid', 'overpaid')),
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('pending', 'reconciled', 'discrepancy', 'failed')),
  payout_date TIMESTAMPTZ,
  amazon_reimbursement_id TEXT,
  matched_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for recoveries
CREATE INDEX IF NOT EXISTS idx_recoveries_dispute_id ON recoveries(dispute_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_user_id ON recoveries(user_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_amazon_case_id ON recoveries(amazon_case_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_reconciliation_status ON recoveries(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_recoveries_matched_at ON recoveries(matched_at);

-- Create recovery_lifecycle_logs table
CREATE TABLE IF NOT EXISTS recovery_lifecycle_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id UUID REFERENCES recoveries(id) ON DELETE CASCADE,
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('payout_detected', 'matched', 'reconciled', 'discrepancy_detected', 'error')),
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for recovery_lifecycle_logs
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_recovery_id ON recovery_lifecycle_logs(recovery_id);
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_dispute_id ON recovery_lifecycle_logs(dispute_id);
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_user_id ON recovery_lifecycle_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_event_type ON recovery_lifecycle_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_created_at ON recovery_lifecycle_logs(created_at);

-- Add recovery_status column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'recovery_status'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN recovery_status TEXT DEFAULT 'pending' CHECK (recovery_status IN ('pending', 'detecting', 'matched', 'reconciled', 'discrepancy', 'failed'));
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_recovery_status ON dispute_cases(recovery_status);
  END IF;
END $$;

-- Add reconciled_at column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'reconciled_at'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN reconciled_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add actual_payout_amount column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'actual_payout_amount'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN actual_payout_amount DECIMAL(10,2);
  END IF;
END $$;

-- Add RLS policies for recoveries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recoveries' 
    AND policyname = 'recoveries_owner_select'
  ) THEN
    CREATE POLICY recoveries_owner_select ON recoveries
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recoveries' 
    AND policyname = 'recoveries_owner_insert'
  ) THEN
    CREATE POLICY recoveries_owner_insert ON recoveries
      FOR INSERT
      WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recoveries' 
    AND policyname = 'recoveries_owner_update'
  ) THEN
    CREATE POLICY recoveries_owner_update ON recoveries
      FOR UPDATE
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;
END $$;

-- Add RLS policies for recovery_lifecycle_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recovery_lifecycle_logs' 
    AND policyname = 'recovery_lifecycle_logs_owner_select'
  ) THEN
    CREATE POLICY recovery_lifecycle_logs_owner_select ON recovery_lifecycle_logs
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recovery_lifecycle_logs' 
    AND policyname = 'recovery_lifecycle_logs_owner_insert'
  ) THEN
    CREATE POLICY recovery_lifecycle_logs_owner_insert ON recovery_lifecycle_logs
      FOR INSERT
      WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;
END $$;

-- Enable RLS on tables
ALTER TABLE recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_lifecycle_logs ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON TABLE recoveries IS 'Tracks payout detection and reconciliation for approved claims';
COMMENT ON TABLE recovery_lifecycle_logs IS 'Logs full lifecycle of recovery processing';
COMMENT ON COLUMN dispute_cases.recovery_status IS 'Status of recovery process: pending, detecting, matched, reconciled, discrepancy, failed';
COMMENT ON COLUMN dispute_cases.reconciled_at IS 'Timestamp when payout was reconciled';
COMMENT ON COLUMN dispute_cases.actual_payout_amount IS 'Actual amount received from Amazon';

