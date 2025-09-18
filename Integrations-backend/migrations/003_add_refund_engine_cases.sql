-- Refund Engine Case Ledger
CREATE TABLE IF NOT EXISTS refund_engine_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  claim_id TEXT NOT NULL,
  mcde_doc_id TEXT,
  case_status TEXT NOT NULL,
  synced_at TIMESTAMP DEFAULT NOW(),
  raw_data JSONB,
  normalized_data JSONB,
  audit_log JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_engine_cases_user_claim ON refund_engine_cases(user_id, claim_id);

-- Enable RLS
ALTER TABLE refund_engine_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own cases" ON refund_engine_cases FOR SELECT USING (auth.uid()::uuid = user_id);
CREATE POLICY "Users can insert their own cases" ON refund_engine_cases FOR INSERT WITH CHECK (auth.uid()::uuid = user_id);
CREATE POLICY "Users can update their own cases" ON refund_engine_cases FOR UPDATE USING (auth.uid()::uuid = user_id);
CREATE POLICY "Users can delete their own cases" ON refund_engine_cases FOR DELETE USING (auth.uid()::uuid = user_id);

-- Sync Progress Table
CREATE TABLE IF NOT EXISTS sync_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stage TEXT NOT NULL,
  percent INT NOT NULL DEFAULT 0,
  total_cases INT NOT NULL DEFAULT 0,
  processed_cases INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_progress_user_id ON sync_progress(user_id);
ALTER TABLE sync_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own sync progress" ON sync_progress FOR SELECT USING (auth.uid()::uuid = user_id);
CREATE POLICY "Users can insert their own sync progress" ON sync_progress FOR INSERT WITH CHECK (auth.uid()::uuid = user_id);
CREATE POLICY "Users can update their own sync progress" ON sync_progress FOR UPDATE USING (auth.uid()::uuid = user_id);
CREATE POLICY "Users can delete their own sync progress" ON sync_progress FOR DELETE USING (auth.uid()::uuid = user_id);