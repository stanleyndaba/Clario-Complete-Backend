-- Migration: Document Parsing Worker Support
-- Adds parser status tracking and error logging for Agent 5

-- Add parser columns to evidence_documents if they don't exist
DO $$
BEGIN
  -- Add parsed_metadata column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'parsed_metadata'
  ) THEN
    ALTER TABLE evidence_documents 
    ADD COLUMN parsed_metadata JSONB;
    
    CREATE INDEX IF NOT EXISTS idx_evidence_documents_parsed_metadata 
    ON evidence_documents USING GIN (parsed_metadata);
  END IF;

  -- Add parser_status column (as TEXT since we don't have the enum in TypeScript backend)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'parser_status'
  ) THEN
    ALTER TABLE evidence_documents 
    ADD COLUMN parser_status TEXT DEFAULT 'pending' 
    CHECK (parser_status IN ('pending', 'processing', 'completed', 'failed', 'requires_manual_review'));
    
    CREATE INDEX IF NOT EXISTS idx_evidence_documents_parser_status 
    ON evidence_documents(parser_status);
  END IF;

  -- Add parser_confidence column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'parser_confidence'
  ) THEN
    ALTER TABLE evidence_documents 
    ADD COLUMN parser_confidence DECIMAL(5,4);
  END IF;

  -- Add parser_error column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'parser_error'
  ) THEN
    ALTER TABLE evidence_documents 
    ADD COLUMN parser_error TEXT;
  END IF;

  -- Add parser_started_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'parser_started_at'
  ) THEN
    ALTER TABLE evidence_documents 
    ADD COLUMN parser_started_at TIMESTAMPTZ;
  END IF;

  -- Add parser_completed_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'parser_completed_at'
  ) THEN
    ALTER TABLE evidence_documents 
    ADD COLUMN parser_completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create document_parsing_errors table
CREATE TABLE IF NOT EXISTS document_parsing_errors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
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

-- Create indexes for document_parsing_errors
CREATE INDEX IF NOT EXISTS idx_document_parsing_errors_document_id 
ON document_parsing_errors(document_id);

CREATE INDEX IF NOT EXISTS idx_document_parsing_errors_seller_id 
ON document_parsing_errors(seller_id);

CREATE INDEX IF NOT EXISTS idx_document_parsing_errors_created_at 
ON document_parsing_errors(created_at);

CREATE INDEX IF NOT EXISTS idx_document_parsing_errors_resolved 
ON document_parsing_errors(resolved) WHERE resolved = FALSE;

-- Enable RLS on document_parsing_errors
ALTER TABLE document_parsing_errors ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can only see their own parsing errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'document_parsing_errors' 
    AND policyname = 'document_parsing_errors_owner_select'
  ) THEN
    CREATE POLICY document_parsing_errors_owner_select
    ON document_parsing_errors
    FOR SELECT
    USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'document_parsing_errors' 
    AND policyname = 'document_parsing_errors_owner_insert'
  ) THEN
    CREATE POLICY document_parsing_errors_owner_insert
    ON document_parsing_errors
    FOR INSERT
    WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'document_parsing_errors' 
    AND policyname = 'document_parsing_errors_owner_update'
  ) THEN
    CREATE POLICY document_parsing_errors_owner_update
    ON document_parsing_errors
    FOR UPDATE
    USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;
END $$;

