-- Migration: Evidence Ingestion Worker Support
-- Adds last_synced_at tracking, storage_path, and error logging table

-- Add last_synced_at to evidence_sources if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_sources' 
    AND column_name = 'last_synced_at'
  ) THEN
    ALTER TABLE evidence_sources 
    ADD COLUMN last_synced_at TIMESTAMPTZ;
    
    CREATE INDEX IF NOT EXISTS idx_evidence_sources_last_synced 
    ON evidence_sources(last_synced_at);
  END IF;
END $$;

-- Ensure evidence_documents has filename, file_size, mime_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evidence_documents'
      AND column_name = 'filename'
  ) THEN
    ALTER TABLE evidence_documents
      ADD COLUMN filename TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evidence_documents'
      AND column_name = 'file_size'
  ) THEN
    ALTER TABLE evidence_documents
      ADD COLUMN file_size BIGINT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'evidence_documents'
      AND column_name = 'mime_type'
  ) THEN
    ALTER TABLE evidence_documents
      ADD COLUMN mime_type TEXT;
  END IF;
END $$;

-- Add storage_path to evidence_documents if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'evidence_documents' 
    AND column_name = 'storage_path'
  ) THEN
    ALTER TABLE evidence_documents 
    ADD COLUMN storage_path TEXT;
    
    CREATE INDEX IF NOT EXISTS idx_evidence_documents_storage_path 
    ON evidence_documents(storage_path);
  END IF;
END $$;

-- Create evidence_ingestion_errors table for error logging
CREATE TABLE IF NOT EXISTS evidence_ingestion_errors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail','outlook','gdrive','dropbox')),
  source_id UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT FALSE
);



-- Indexes for error table
CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_errors_user 
ON evidence_ingestion_errors(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_errors_provider 
ON evidence_ingestion_errors(provider, resolved);

CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_errors_unresolved 
ON evidence_ingestion_errors(resolved, created_at) 
WHERE resolved = FALSE;

-- RLS for error table
ALTER TABLE evidence_ingestion_errors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'evidence_ingestion_errors'
      AND policyname = 'evidence_ingestion_errors_owner_select'
  ) THEN
    CREATE POLICY evidence_ingestion_errors_owner_select
    ON evidence_ingestion_errors
    FOR SELECT
    USING (auth.uid()::text = user_id);
  END IF;
END $$;

