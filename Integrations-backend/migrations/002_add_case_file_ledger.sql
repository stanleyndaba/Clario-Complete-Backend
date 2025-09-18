-- Migration: Add Case File Ledger and Refund Engine Tables
-- This migration adds the necessary tables for the enhanced data orchestration layer

-- Create refund_engine_cases table
CREATE TABLE IF NOT EXISTS refund_engine_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  case_id TEXT NOT NULL UNIQUE,
  claim_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'paid')),
  total_amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  claim_type TEXT NOT NULL,
  documents JSONB DEFAULT '[]'::jsonb,
  ledger_entries JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sync_progress table for tracking sync status
CREATE TABLE IF NOT EXISTS sync_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 1,
  total_steps INTEGER NOT NULL DEFAULT 5,
  current_step TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, sync_id)
);

-- Create stripe_accounts table for silent Stripe Connect
CREATE TABLE IF NOT EXISTS stripe_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  account_status TEXT NOT NULL DEFAULT 'pending',
  charges_enabled BOOLEAN DEFAULT FALSE,
  payouts_enabled BOOLEAN DEFAULT FALSE,
  details_submitted BOOLEAN DEFAULT FALSE,
  business_type TEXT,
  country TEXT,
  email TEXT,
  default_currency TEXT DEFAULT 'usd',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_refund_engine_cases_user_id ON refund_engine_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_engine_cases_claim_id ON refund_engine_cases(claim_id);
CREATE INDEX IF NOT EXISTS idx_refund_engine_cases_status ON refund_engine_cases(status);
CREATE INDEX IF NOT EXISTS idx_refund_engine_cases_created_at ON refund_engine_cases(created_at);

CREATE INDEX IF NOT EXISTS idx_sync_progress_user_id ON sync_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_progress_sync_id ON sync_progress(sync_id);
CREATE INDEX IF NOT EXISTS idx_sync_progress_status ON sync_progress(status);
CREATE INDEX IF NOT EXISTS idx_sync_progress_created_at ON sync_progress(created_at);

CREATE INDEX IF NOT EXISTS idx_stripe_accounts_user_id ON stripe_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_accounts_stripe_account_id ON stripe_accounts(stripe_account_id);
CREATE INDEX IF NOT EXISTS idx_stripe_accounts_account_status ON stripe_accounts(account_status);

-- Add RLS (Row Level Security) policies
ALTER TABLE refund_engine_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY;

-- RLS policies for refund_engine_cases
CREATE POLICY "Users can view their own refund engine cases" ON refund_engine_cases
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own refund engine cases" ON refund_engine_cases
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own refund engine cases" ON refund_engine_cases
  FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "Users can delete their own refund engine cases" ON refund_engine_cases
  FOR DELETE USING (auth.uid()::text = user_id);

-- RLS policies for sync_progress
CREATE POLICY "Users can view their own sync progress" ON sync_progress
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own sync progress" ON sync_progress
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own sync progress" ON sync_progress
  FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "Users can delete their own sync progress" ON sync_progress
  FOR DELETE USING (auth.uid()::text = user_id);

-- RLS policies for stripe_accounts
CREATE POLICY "Users can view their own stripe accounts" ON stripe_accounts
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own stripe accounts" ON stripe_accounts
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own stripe accounts" ON stripe_accounts
  FOR UPDATE USING (auth.uid()::text = user_id);

CREATE POLICY "Users can delete their own stripe accounts" ON stripe_accounts
  FOR DELETE USING (auth.uid()::text = user_id);

-- Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_refund_engine_cases_updated_at 
  BEFORE UPDATE ON refund_engine_cases 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sync_progress_updated_at 
  BEFORE UPDATE ON sync_progress 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stripe_accounts_updated_at 
  BEFORE UPDATE ON stripe_accounts 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE refund_engine_cases IS 'Stores refund engine cases with their associated documents and ledger entries';
COMMENT ON TABLE sync_progress IS 'Tracks the progress of data synchronization jobs';
COMMENT ON TABLE stripe_accounts IS 'Stores Stripe Connect account information for silent onboarding';

COMMENT ON COLUMN refund_engine_cases.case_id IS 'Unique case identifier for the refund engine';
COMMENT ON COLUMN refund_engine_cases.claim_id IS 'Original claim ID from the source system (e.g., Amazon)';
COMMENT ON COLUMN refund_engine_cases.documents IS 'JSON array of MCDE documents linked to this case';
COMMENT ON COLUMN refund_engine_cases.ledger_entries IS 'JSON array of ledger entries for audit tracking';

COMMENT ON COLUMN sync_progress.sync_id IS 'Unique identifier for the sync operation';
COMMENT ON COLUMN sync_progress.progress IS 'Progress percentage (0-100)';
COMMENT ON COLUMN sync_progress.metadata IS 'Additional metadata for the sync operation';

COMMENT ON COLUMN stripe_accounts.stripe_account_id IS 'Stripe Connect account ID';
COMMENT ON COLUMN stripe_accounts.account_status IS 'Status of the Stripe account (pending, active, restricted, etc.)'; 