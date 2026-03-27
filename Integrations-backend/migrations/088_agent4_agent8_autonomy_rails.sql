-- Migration: 088_agent4_agent8_autonomy_rails
-- Purpose: Harden Agent 4→8 autonomy rails with durable parser lifecycle metadata

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'evidence_documents'
      AND column_name = 'parser_job_id'
  ) THEN
    ALTER TABLE evidence_documents
      ADD COLUMN parser_job_id UUID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'evidence_documents'
      AND column_name = 'parsed_at'
  ) THEN
    ALTER TABLE evidence_documents
      ADD COLUMN parsed_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_evidence_documents_parser_job_id
  ON evidence_documents(parser_job_id);

CREATE INDEX IF NOT EXISTS idx_parser_jobs_tenant_status_created
  ON parser_jobs(tenant_id, status, created_at DESC);

ALTER TABLE evidence_documents
  DROP CONSTRAINT IF EXISTS evidence_documents_parser_status_check;

ALTER TABLE evidence_documents
  ADD CONSTRAINT evidence_documents_parser_status_check
  CHECK (
    parser_status IN (
      'pending',
      'processing',
      'completed',
      'failed',
      'retrying',
      'requires_manual_review'
    )
  );
