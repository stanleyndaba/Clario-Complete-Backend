-- Migration: Fix missing parser_jobs table
-- Required by Python API for document parsing job tracking

CREATE TABLE IF NOT EXISTS parser_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_parser_jobs_document_id ON parser_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_status ON parser_jobs(status);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_created_at ON parser_jobs(created_at);

-- Enable RLS
ALTER TABLE parser_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Public for now as Python API might use service role, but good practice)
CREATE POLICY parser_jobs_read_policy ON parser_jobs
  FOR SELECT USING (true);

CREATE POLICY parser_jobs_insert_policy ON parser_jobs
  FOR INSERT WITH CHECK (true);

CREATE POLICY parser_jobs_update_policy ON parser_jobs
  FOR UPDATE USING (true);
