-- Migration 037: Evidence Match Results Table + Test Providers
-- Created: 2025-12-30
-- Purpose: Creates table for storing evidence matching results and adds test providers

-- ============================================================
-- 1. Add test providers to evidence_sources provider enum
-- ============================================================
DO $$
BEGIN
  -- Update the CHECK constraint on evidence_sources to include test providers
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'evidence_sources' 
    AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%provider%'
  ) THEN
    ALTER TABLE evidence_sources DROP CONSTRAINT IF EXISTS evidence_sources_provider_check;
  END IF;
  
  -- Add new CHECK with expanded providers list
  ALTER TABLE evidence_sources 
  ADD CONSTRAINT evidence_sources_provider_check 
  CHECK (provider IN (
    'gmail', 'outlook', 'dropbox', 'gdrive', 'onedrive', 's3', 'other',
    'manual_upload', 'test_generator', 'test_e2e', 'api_upload', 'webhook', 'local'
  ));
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Could not update evidence_sources provider constraint: %', SQLERRM;
END $$;

-- ============================================================
-- 2. Add provider column to evidence_documents if not exists
--    and ensure it accepts our test providers
-- ============================================================
DO $$
BEGIN
  -- Add provider column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'provider'
  ) THEN
    ALTER TABLE evidence_documents ADD COLUMN provider TEXT;
  END IF;
  
  -- Drop existing CHECK constraint on provider if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'provider'
  ) THEN
    ALTER TABLE evidence_documents DROP CONSTRAINT IF EXISTS evidence_documents_provider_check;
  END IF;
END $$;

-- ============================================================
-- 3. Create evidence_match_results table
-- ============================================================
CREATE TABLE IF NOT EXISTS evidence_match_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Ownership
  user_id UUID,
  seller_id TEXT NOT NULL,
  
  -- References
  claim_id UUID REFERENCES detection_results(id) ON DELETE CASCADE,
  document_id UUID REFERENCES evidence_documents(id) ON DELETE CASCADE,
  
  -- Match details
  match_type TEXT NOT NULL, -- order_id, tracking_number, asin, sku, fnsku, lpn, etc.
  matched_fields TEXT[] DEFAULT '{}', -- Array of matched identifier:value pairs
  confidence_score DECIMAL(5,4) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  rule_score DECIMAL(5,4), -- Score from matching rules
  
  -- Action taken
  action_taken TEXT NOT NULL DEFAULT 'pending' CHECK (action_taken IN (
    'pending', 'auto_submit', 'smart_prompt', 'manual_review', 'rejected', 'approved'
  )),
  
  -- Reasoning
  reasoning TEXT,
  
  -- Smart prompt reference
  smart_prompt_id UUID REFERENCES smart_prompts(id) ON DELETE SET NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'submitted', 'expired'
  )),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  
  -- Metadata
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. Create indexes for evidence_match_results
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_match_results_seller_id 
ON evidence_match_results(seller_id);

CREATE INDEX IF NOT EXISTS idx_match_results_user_id 
ON evidence_match_results(user_id);

CREATE INDEX IF NOT EXISTS idx_match_results_claim_id 
ON evidence_match_results(claim_id);

CREATE INDEX IF NOT EXISTS idx_match_results_document_id 
ON evidence_match_results(document_id);

CREATE INDEX IF NOT EXISTS idx_match_results_match_type 
ON evidence_match_results(match_type);

CREATE INDEX IF NOT EXISTS idx_match_results_action_taken 
ON evidence_match_results(action_taken);

CREATE INDEX IF NOT EXISTS idx_match_results_status 
ON evidence_match_results(status);

CREATE INDEX IF NOT EXISTS idx_match_results_confidence 
ON evidence_match_results(confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_match_results_created_at 
ON evidence_match_results(created_at DESC);

-- ============================================================
-- 5. Enable RLS on evidence_match_results
-- ============================================================
ALTER TABLE evidence_match_results ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. Create RLS policies
-- ============================================================
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS match_results_owner_select ON evidence_match_results;
  DROP POLICY IF EXISTS match_results_owner_insert ON evidence_match_results;
  DROP POLICY IF EXISTS match_results_owner_update ON evidence_match_results;
  DROP POLICY IF EXISTS match_results_owner_delete ON evidence_match_results;
  
  -- Create new policies
  CREATE POLICY match_results_owner_select ON evidence_match_results
    FOR SELECT 
    USING (
      CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT) OR
      CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
    );
  
  CREATE POLICY match_results_owner_insert ON evidence_match_results
    FOR INSERT 
    WITH CHECK (
      CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT) OR
      CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
    );
  
  CREATE POLICY match_results_owner_update ON evidence_match_results
    FOR UPDATE 
    USING (
      CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT) OR
      CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
    );
  
  CREATE POLICY match_results_owner_delete ON evidence_match_results
    FOR DELETE 
    USING (
      CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT) OR
      CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
    );
END $$;

-- ============================================================
-- 7. Create trigger for updated_at
-- ============================================================
DO $$
BEGIN
  -- Create the trigger if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_match_results_updated_at') THEN
    CREATE TRIGGER update_match_results_updated_at
      BEFORE UPDATE ON evidence_match_results
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
EXCEPTION
  WHEN undefined_function THEN
    -- If update_updated_at_column doesn't exist, create it
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
    
    CREATE TRIGGER update_match_results_updated_at
      BEFORE UPDATE ON evidence_match_results
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
END $$;

-- ============================================================
-- 8. Create view for match summary
-- ============================================================
CREATE OR REPLACE VIEW evidence_match_summary AS
SELECT 
  emr.id,
  emr.seller_id,
  emr.claim_id,
  emr.document_id,
  emr.match_type,
  emr.confidence_score,
  emr.action_taken,
  emr.status,
  emr.reasoning,
  emr.created_at,
  dr.anomaly_type AS claim_type,
  dr.estimated_value AS claim_value,
  ed.filename AS document_name,
  ed.doc_type AS document_type
FROM evidence_match_results emr
LEFT JOIN detection_results dr ON emr.claim_id = dr.id
LEFT JOIN evidence_documents ed ON emr.document_id = ed.id;

COMMENT ON VIEW evidence_match_summary IS 'Summary view of evidence matches with claim and document details';

-- ============================================================
-- 9. Documentation
-- ============================================================
COMMENT ON TABLE evidence_match_results IS 'Stores results of evidence matching between claims and documents';
COMMENT ON COLUMN evidence_match_results.match_type IS 'Type of match: order_id, tracking_number, asin, sku, fnsku, lpn, shipment_id, etc.';
COMMENT ON COLUMN evidence_match_results.matched_fields IS 'Array of matched identifier:value pairs, e.g., ["order_id:111-2222-3333"]';
COMMENT ON COLUMN evidence_match_results.confidence_score IS 'Confidence score from 0.0 to 1.0';
COMMENT ON COLUMN evidence_match_results.action_taken IS 'Action based on confidence: auto_submit (>85%), smart_prompt (50-85%), etc.';
COMMENT ON COLUMN evidence_match_results.reasoning IS 'Human-readable explanation of the match';
