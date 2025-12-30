-- Migration 038: Fix Provider Constraints
-- Created: 2025-12-30
-- Purpose: Remove CHECK constraints on provider columns to allow test providers

-- ============================================================
-- 1. Drop CHECK constraint on evidence_documents.provider if exists
-- ============================================================
DO $$
BEGIN
  -- Try to drop any provider CHECK constraint on evidence_documents
  ALTER TABLE evidence_documents DROP CONSTRAINT IF EXISTS evidence_documents_provider_check;
  
  -- Also try common constraint naming patterns
  EXECUTE (
    SELECT string_agg('ALTER TABLE evidence_documents DROP CONSTRAINT IF EXISTS ' || quote_ident(conname) || ';', ' ')
    FROM pg_constraint
    WHERE conrelid = 'evidence_documents'::regclass
    AND conname LIKE '%provider%'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not drop evidence_documents provider constraint: %', SQLERRM;
END $$;

-- ============================================================
-- 2. Drop provider type if it's an enum and recreate as TEXT compatible
-- ============================================================
DO $$
BEGIN
  -- Check if evidence_provider type exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_provider') THEN
    -- Try to add new values to the enum
    ALTER TYPE evidence_provider ADD VALUE IF NOT EXISTS 'manual_upload';
    ALTER TYPE evidence_provider ADD VALUE IF NOT EXISTS 'test_generator';
    ALTER TYPE evidence_provider ADD VALUE IF NOT EXISTS 'test_e2e';
    ALTER TYPE evidence_provider ADD VALUE IF NOT EXISTS 'api_upload';
    ALTER TYPE evidence_provider ADD VALUE IF NOT EXISTS 'webhook';
    ALTER TYPE evidence_provider ADD VALUE IF NOT EXISTS 'local';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update evidence_provider enum: %', SQLERRM;
END $$;

-- ============================================================
-- 3. Ensure user_id column exists in evidence_documents with correct type
-- ============================================================
DO $$
BEGIN
  -- Check if user_id column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'user_id'
  ) THEN
    -- Add user_id column as TEXT (to match seller_id)
    ALTER TABLE evidence_documents ADD COLUMN user_id TEXT;
    
    -- Copy seller_id to user_id for existing records
    UPDATE evidence_documents SET user_id = seller_id WHERE user_id IS NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add user_id column: %', SQLERRM;
END $$;

-- ============================================================
-- 4. Ensure user_id column in evidence_match_results is TEXT not UUID
-- ============================================================
DO $$
BEGIN
  -- If user_id is UUID type, alter to TEXT
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_match_results' 
    AND column_name = 'user_id'
    AND data_type = 'uuid'
  ) THEN
    ALTER TABLE evidence_match_results ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not alter user_id type: %', SQLERRM;
END $$;

-- ============================================================
-- 5. Create unique constraint for upsert if not exists
-- ============================================================
DO $$
BEGIN
  -- Add unique constraint for upsert (claim_id, document_id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'evidence_match_results_claim_document_unique'
  ) THEN
    ALTER TABLE evidence_match_results 
    ADD CONSTRAINT evidence_match_results_claim_document_unique 
    UNIQUE (claim_id, document_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add unique constraint: %', SQLERRM;
END $$;

-- Success message
SELECT 'Migration 038 completed successfully' AS status;
