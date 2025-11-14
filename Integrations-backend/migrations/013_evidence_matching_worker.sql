-- Migration: Evidence Matching Worker Support
-- Adds error logging for Agent 6

-- Create evidence_matching_errors table
CREATE TABLE IF NOT EXISTS evidence_matching_errors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT FALSE
);

-- Create indexes for evidence_matching_errors
CREATE INDEX IF NOT EXISTS idx_evidence_matching_errors_seller_id 
ON evidence_matching_errors(seller_id);

CREATE INDEX IF NOT EXISTS idx_evidence_matching_errors_created_at 
ON evidence_matching_errors(created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_matching_errors_resolved 
ON evidence_matching_errors(resolved) WHERE resolved = FALSE;

-- Enable RLS on evidence_matching_errors
ALTER TABLE evidence_matching_errors ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can only see their own matching errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'evidence_matching_errors' 
    AND policyname = 'evidence_matching_errors_owner_select'
  ) THEN
    CREATE POLICY evidence_matching_errors_owner_select
    ON evidence_matching_errors
    FOR SELECT
    USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'evidence_matching_errors' 
    AND policyname = 'evidence_matching_errors_owner_insert'
  ) THEN
    CREATE POLICY evidence_matching_errors_owner_insert
    ON evidence_matching_errors
    FOR INSERT
    WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'evidence_matching_errors' 
    AND policyname = 'evidence_matching_errors_owner_update'
  ) THEN
    CREATE POLICY evidence_matching_errors_owner_update
    ON evidence_matching_errors
    FOR UPDATE
    USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;
END $$;

-- Add match_confidence column to detection_results if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'detection_results' 
    AND column_name = 'match_confidence'
  ) THEN
    ALTER TABLE detection_results 
    ADD COLUMN match_confidence DECIMAL(5,4);
    
    CREATE INDEX IF NOT EXISTS idx_detection_results_match_confidence 
    ON detection_results(match_confidence);
  END IF;
END $$;

