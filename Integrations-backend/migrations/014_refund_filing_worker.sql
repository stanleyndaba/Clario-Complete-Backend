-- Migration: Add Refund Filing Worker Support (Agent 7)
-- Adds filing status tracking, error logging, and submission tracking

-- Add filing_status column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'filing_status'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN filing_status TEXT DEFAULT 'pending' CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed'));
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_filing_status ON dispute_cases(filing_status);
  END IF;
END $$;

-- Add retry_count column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN retry_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create refund_filing_errors table
CREATE TABLE IF NOT EXISTS refund_filing_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  submission_id UUID,
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

-- Create indexes for refund_filing_errors
CREATE INDEX IF NOT EXISTS idx_refund_filing_errors_user_id ON refund_filing_errors(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_filing_errors_dispute_id ON refund_filing_errors(dispute_id);
CREATE INDEX IF NOT EXISTS idx_refund_filing_errors_created_at ON refund_filing_errors(created_at);
CREATE INDEX IF NOT EXISTS idx_refund_filing_errors_resolved ON refund_filing_errors(resolved);

-- Create dispute_submissions table if it doesn't exist
CREATE TABLE IF NOT EXISTS dispute_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  user_id TEXT,
  submission_id TEXT,
  amazon_case_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'open', 'in_progress', 'approved', 'denied', 'rejected', 'closed', 'failed')),
  last_status_check TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for dispute_submissions
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_dispute_id ON dispute_submissions(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_submission_id ON dispute_submissions(submission_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_amazon_case_id ON dispute_submissions(amazon_case_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_status ON dispute_submissions(status);

-- Add RLS policies for refund_filing_errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'refund_filing_errors' 
    AND policyname = 'refund_filing_errors_owner_select'
  ) THEN
    CREATE POLICY refund_filing_errors_owner_select ON refund_filing_errors
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'refund_filing_errors' 
    AND policyname = 'refund_filing_errors_owner_insert'
  ) THEN
    CREATE POLICY refund_filing_errors_owner_insert ON refund_filing_errors
      FOR INSERT
      WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;
END $$;

-- Add RLS policies for dispute_submissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'dispute_submissions' 
    AND policyname = 'dispute_submissions_owner_select'
  ) THEN
    CREATE POLICY dispute_submissions_owner_select ON dispute_submissions
      FOR SELECT
      USING (
        CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
        OR EXISTS (
          SELECT 1 FROM dispute_cases dc
          WHERE dc.id = dispute_submissions.dispute_id
          AND CAST(auth.uid() AS TEXT) = CAST(dc.seller_id AS TEXT)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'dispute_submissions' 
    AND policyname = 'dispute_submissions_owner_insert'
  ) THEN
    CREATE POLICY dispute_submissions_owner_insert ON dispute_submissions
      FOR INSERT
      WITH CHECK (
        CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
        OR EXISTS (
          SELECT 1 FROM dispute_cases dc
          WHERE dc.id = dispute_submissions.dispute_id
          AND CAST(auth.uid() AS TEXT) = CAST(dc.seller_id AS TEXT)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'dispute_submissions' 
    AND policyname = 'dispute_submissions_owner_update'
  ) THEN
    CREATE POLICY dispute_submissions_owner_update ON dispute_submissions
      FOR UPDATE
      USING (
        CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
        OR EXISTS (
          SELECT 1 FROM dispute_cases dc
          WHERE dc.id = dispute_submissions.dispute_id
          AND CAST(auth.uid() AS TEXT) = CAST(dc.seller_id AS TEXT)
        )
      );
  END IF;
END $$;

-- Enable RLS on tables
ALTER TABLE refund_filing_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_submissions ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON TABLE refund_filing_errors IS 'Logs errors from refund filing operations';
COMMENT ON TABLE dispute_submissions IS 'Tracks dispute submissions to Amazon SP-API';
COMMENT ON COLUMN dispute_cases.filing_status IS 'Status of filing process: pending, filing, filed, retrying, failed';
COMMENT ON COLUMN dispute_cases.retry_count IS 'Number of filing retry attempts';

