-- Migration: Fix missing parser_jobs table
-- Required by Python API for document parsing job tracking

CREATE TABLE IF NOT EXISTS parser_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
  user_id UUID, -- Optional, can be NULL for service-level jobs
  parser_type TEXT NOT NULL DEFAULT 'pdf',
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns if table already exists (for existing deployments)
DO $$ 
BEGIN
  -- Add user_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'user_id') THEN
    ALTER TABLE parser_jobs ADD COLUMN user_id UUID;
  END IF;
  
  -- Add parser_type if missing (with default)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'parser_type') THEN
    ALTER TABLE parser_jobs ADD COLUMN parser_type TEXT NOT NULL DEFAULT 'pdf';
  END IF;
  
  -- Add started_at if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'started_at') THEN
    ALTER TABLE parser_jobs ADD COLUMN started_at TIMESTAMPTZ;
  END IF;
  
  -- Add completed_at if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'completed_at') THEN
    ALTER TABLE parser_jobs ADD COLUMN completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_parser_jobs_document_id ON parser_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_user_id ON parser_jobs(user_id) WHERE user_id IS NOT NULL;
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
