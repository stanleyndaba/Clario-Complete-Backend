-- ========================================
-- Migration: pending_jobs table
-- Safety net for failed inter-agent handoffs
-- ========================================

-- Create pending_jobs table - catches failed cross-agent calls for later retry
CREATE TABLE IF NOT EXISTS pending_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_type TEXT NOT NULL,           -- 'evidence_matching', 'document_parsing', etc.
  user_id TEXT NOT NULL,            -- seller/user who owns this work
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- job-specific data (claims, doc IDs, etc.)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Index for efficient polling by status + job_type
CREATE INDEX IF NOT EXISTS idx_pending_jobs_status_type ON pending_jobs(status, job_type);
-- Index for user-scoped queries
CREATE INDEX IF NOT EXISTS idx_pending_jobs_user ON pending_jobs(user_id, status);
-- Index for retry scheduling
CREATE INDEX IF NOT EXISTS idx_pending_jobs_retry ON pending_jobs(status, next_retry_at) WHERE status = 'pending';

-- Auto-update updated_at on modification
CREATE OR REPLACE FUNCTION update_pending_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_pending_jobs_updated_at
  BEFORE UPDATE ON pending_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_pending_jobs_updated_at();

-- RLS: Users can only see their own pending jobs
ALTER TABLE pending_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pending jobs" ON pending_jobs
  FOR SELECT USING (auth.uid()::text = user_id);

-- Service role can do everything (for workers)
CREATE POLICY "Service role full access to pending_jobs" ON pending_jobs
  FOR ALL USING (auth.role() = 'service_role');
