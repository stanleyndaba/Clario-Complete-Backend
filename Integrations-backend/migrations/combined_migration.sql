-- Combined Migration Script
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/uuuqpujtnubusmigbkvw/sql/new


-- ========================================
-- Migration: 002_add_case_file_ledger.sql
-- ========================================

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
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
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


-- ========================================
-- Migration: 003_add_refund_engine_cases.sql
-- ========================================

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


-- ========================================
-- Migration: 003_add_stripe_accounts.sql
-- ========================================

-- Silent Stripe Onboarding: Stripe Accounts Table
CREATE TABLE IF NOT EXISTS stripe_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_accounts_user_id ON stripe_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_accounts_stripe_account_id ON stripe_accounts(stripe_account_id);

-- Enable Row Level Security
ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY;

-- RLS: Only allow users to access their own stripe account
CREATE POLICY "Users can view their own stripe account" ON stripe_accounts
  FOR SELECT USING (auth.uid()::uuid = user_id);
CREATE POLICY "Users can insert their own stripe account" ON stripe_accounts
  FOR INSERT WITH CHECK (auth.uid()::uuid = user_id);
CREATE POLICY "Users can update their own stripe account" ON stripe_accounts
  FOR UPDATE USING (auth.uid()::uuid = user_id);
CREATE POLICY "Users can delete their own stripe account" ON stripe_accounts
  FOR DELETE USING (auth.uid()::uuid = user_id);


-- ========================================
-- Migration: 004_add_financial_events_and_detection.sql
-- ========================================

-- Migration: Add Financial Events and Detection Results Tables
-- This migration adds tables for financial event archival and anomaly detection

-- Create financial_events table for Amazon financial event ingestion
CREATE TABLE IF NOT EXISTS financial_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('fee', 'reimbursement', 'return', 'shipment')),
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  amazon_event_id TEXT,
  amazon_order_id TEXT,
  amazon_sku TEXT,
  event_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create detection_results table for anomaly detection
CREATE TABLE IF NOT EXISTS detection_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN ('missing_unit', 'overcharge', 'damaged_stock', 'incorrect_fee', 'duplicate_charge')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  estimated_value DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  confidence_score DECIMAL(3,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'disputed', 'resolved')),
  related_event_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create detection_queue table for processing detection jobs
CREATE TABLE IF NOT EXISTS detection_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  sync_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER NOT NULL DEFAULT 1 CHECK (priority >= 1 AND priority <= 10),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_financial_events_seller_id ON financial_events(seller_id);
CREATE INDEX IF NOT EXISTS idx_financial_events_event_type ON financial_events(event_type);
CREATE INDEX IF NOT EXISTS idx_financial_events_amazon_event_id ON financial_events(amazon_event_id);
CREATE INDEX IF NOT EXISTS idx_financial_events_amazon_order_id ON financial_events(amazon_order_id);
CREATE INDEX IF NOT EXISTS idx_financial_events_event_date ON financial_events(event_date);
CREATE INDEX IF NOT EXISTS idx_financial_events_created_at ON financial_events(created_at);

CREATE INDEX IF NOT EXISTS idx_detection_results_seller_id ON detection_results(seller_id);
CREATE INDEX IF NOT EXISTS idx_detection_results_sync_id ON detection_results(sync_id);
CREATE INDEX IF NOT EXISTS idx_detection_results_anomaly_type ON detection_results(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_detection_results_severity ON detection_results(severity);
CREATE INDEX IF NOT EXISTS idx_detection_results_status ON detection_results(status);
CREATE INDEX IF NOT EXISTS idx_detection_results_created_at ON detection_results(created_at);

CREATE INDEX IF NOT EXISTS idx_detection_queue_seller_id ON detection_queue(seller_id);
CREATE INDEX IF NOT EXISTS idx_detection_queue_sync_id ON detection_queue(sync_id);
CREATE INDEX IF NOT EXISTS idx_detection_queue_status ON detection_queue(status);
CREATE INDEX IF NOT EXISTS idx_detection_queue_priority ON detection_queue(priority);
CREATE INDEX IF NOT EXISTS idx_detection_queue_created_at ON detection_queue(created_at);

-- Add RLS (Row Level Security) policies
ALTER TABLE financial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies for financial_events
CREATE POLICY "Users can view their own financial events" ON financial_events
  FOR SELECT USING (auth.uid()::text = seller_id);

CREATE POLICY "Users can insert their own financial events" ON financial_events
  FOR INSERT WITH CHECK (auth.uid()::text = seller_id);

CREATE POLICY "Users can update their own financial events" ON financial_events
  FOR UPDATE USING (auth.uid()::text = seller_id);

-- RLS policies for detection_results
CREATE POLICY "Users can view their own detection results" ON detection_results
  FOR SELECT USING (auth.uid()::text = seller_id);

CREATE POLICY "Users can insert their own detection results" ON detection_results
  FOR INSERT WITH CHECK (auth.uid()::text = seller_id);

CREATE POLICY "Users can update their own detection results" ON detection_results
  FOR UPDATE USING (auth.uid()::text = seller_id);

-- RLS policies for detection_queue
CREATE POLICY "Users can view their own detection queue items" ON detection_queue
  FOR SELECT USING (auth.uid()::text = seller_id);

CREATE POLICY "Users can insert their own detection queue items" ON detection_queue
  FOR INSERT WITH CHECK (auth.uid()::text = seller_id);

CREATE POLICY "Users can update their own detection queue items" ON detection_queue
  FOR UPDATE USING (auth.uid()::text = seller_id);

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_financial_events_updated_at 
  BEFORE UPDATE ON financial_events 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_detection_results_updated_at 
  BEFORE UPDATE ON detection_results 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_detection_queue_updated_at 
  BEFORE UPDATE ON detection_queue 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE financial_events IS 'Stores Amazon financial events (fees, reimbursements, returns, shipments) for archival and analysis';
COMMENT ON TABLE detection_results IS 'Stores anomaly detection results from sync operations';
COMMENT ON TABLE detection_queue IS 'Queue for processing detection jobs after sync completion';

COMMENT ON COLUMN financial_events.event_type IS 'Type of financial event (fee, reimbursement, return, shipment)';
COMMENT ON COLUMN financial_events.raw_payload IS 'Complete raw event payload from Amazon for archival';
COMMENT ON COLUMN financial_events.amazon_event_id IS 'Unique Amazon event identifier';
COMMENT ON COLUMN financial_events.amazon_order_id IS 'Amazon order ID if applicable';

COMMENT ON COLUMN detection_results.anomaly_type IS 'Type of detected anomaly';
COMMENT ON COLUMN detection_results.severity IS 'Severity level of the anomaly';
COMMENT ON COLUMN detection_results.confidence_score IS 'Confidence score of the detection (0-1)';
COMMENT ON COLUMN detection_results.evidence IS 'JSON evidence supporting the anomaly detection';
COMMENT ON COLUMN detection_results.related_event_ids IS 'Array of related financial event IDs';

COMMENT ON COLUMN detection_queue.priority IS 'Processing priority (1=lowest, 10=highest)';
COMMENT ON COLUMN detection_queue.attempts IS 'Number of processing attempts made';
COMMENT ON COLUMN detection_queue.payload IS 'Job payload containing sync and detection parameters';






-- ========================================
-- Migration: 005_add_dispute_system.sql
-- ========================================

-- Migration: Add Dispute System and Enhanced Detection Pipeline
-- This migration adds tables for dispute management and enhances the detection pipeline

-- Create dispute_cases table for tracking reimbursement claims
CREATE TABLE IF NOT EXISTS dispute_cases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  detection_result_id UUID NOT NULL REFERENCES detection_results(id) ON DELETE CASCADE,
  case_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'rejected', 'closed')),
  claim_amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  case_type TEXT NOT NULL CHECK (case_type IN ('amazon_fba', 'stripe_dispute', 'shopify_refund')),
  provider TEXT NOT NULL CHECK (provider IN ('amazon', 'stripe', 'shopify')),
  submission_date TIMESTAMP WITH TIME ZONE,
  resolution_date TIMESTAMP WITH TIME ZONE,
  resolution_amount DECIMAL(10,2),
  resolution_notes TEXT,
  evidence_attachments JSONB DEFAULT '{}'::jsonb,
  provider_case_id TEXT,
  provider_response JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create dispute_automation_rules table for configurable automation
CREATE TABLE IF NOT EXISTS dispute_automation_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('auto_submit', 'auto_approve', 'threshold_based', 'whitelist_based')),
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create dispute_evidence table for storing evidence artifacts
CREATE TABLE IF NOT EXISTS dispute_evidence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('document', 'screenshot', 'api_response', 'calculation', 'audit_log')),
  file_path TEXT,
  s3_url TEXT,
  file_size INTEGER,
  mime_type TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create dispute_audit_log table for tracking case changes
CREATE TABLE IF NOT EXISTS dispute_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL,
  old_values JSONB DEFAULT '{}'::jsonb,
  new_values JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create detection_thresholds table for configurable anomaly detection
CREATE TABLE IF NOT EXISTS detection_thresholds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT, -- NULL for global defaults
  rule_type TEXT NOT NULL CHECK (rule_type IN ('missing_unit', 'overcharge', 'damaged_stock', 'incorrect_fee', 'duplicate_charge')),
  threshold_value DECIMAL(10,2) NOT NULL,
  threshold_operator TEXT NOT NULL CHECK (threshold_operator IN ('gt', 'gte', 'lt', 'lte', 'eq')),
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create detection_whitelist table for excluding specific items
CREATE TABLE IF NOT EXISTS detection_whitelist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  whitelist_type TEXT NOT NULL CHECK (whitelist_type IN ('sku', 'asin', 'vendor', 'shipment', 'order')),
  whitelist_value TEXT NOT NULL,
  reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sync_detection_triggers table for tracking sync-to-detection pipeline
CREATE TABLE IF NOT EXISTS sync_detection_triggers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('inventory', 'financial', 'product', 'manual')),
  detection_job_id UUID REFERENCES detection_queue(id),
  status TEXT NOT NULL DEFAULT 'triggered' CHECK (status IN ('triggered', 'detection_queued', 'detection_completed', 'dispute_created')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_dispute_cases_seller_id ON dispute_cases(seller_id);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_status ON dispute_cases(status);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_case_type ON dispute_cases(case_type);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_provider ON dispute_cases(provider);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_created_at ON dispute_cases(created_at);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_detection_result_id ON dispute_cases(detection_result_id);

CREATE INDEX IF NOT EXISTS idx_dispute_automation_rules_seller_id ON dispute_automation_rules(seller_id);
CREATE INDEX IF NOT EXISTS idx_dispute_automation_rules_rule_type ON dispute_automation_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_dispute_automation_rules_is_active ON dispute_automation_rules(is_active);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute_case_id ON dispute_evidence(dispute_case_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_evidence_type ON dispute_evidence(evidence_type);

CREATE INDEX IF NOT EXISTS idx_dispute_audit_log_dispute_case_id ON dispute_audit_log(dispute_case_id);
CREATE INDEX IF NOT EXISTS idx_dispute_audit_log_action ON dispute_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_dispute_audit_log_created_at ON dispute_audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_detection_thresholds_seller_id ON detection_thresholds(seller_id);
CREATE INDEX IF NOT EXISTS idx_detection_thresholds_rule_type ON detection_thresholds(rule_type);
CREATE INDEX IF NOT EXISTS idx_detection_thresholds_is_active ON detection_thresholds(is_active);

CREATE INDEX IF NOT EXISTS idx_detection_whitelist_seller_id ON detection_whitelist(seller_id);
CREATE INDEX IF NOT EXISTS idx_detection_whitelist_whitelist_type ON detection_whitelist(whitelist_type);
CREATE INDEX IF NOT EXISTS idx_detection_whitelist_is_active ON detection_whitelist(is_active);

CREATE INDEX IF NOT EXISTS idx_sync_detection_triggers_sync_id ON sync_detection_triggers(sync_id);
CREATE INDEX IF NOT EXISTS idx_sync_detection_triggers_seller_id ON sync_detection_triggers(seller_id);
CREATE INDEX IF NOT EXISTS idx_sync_detection_triggers_status ON sync_detection_triggers(status);

-- Add unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_cases_case_number ON dispute_cases(case_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_cases_detection_result_id ON dispute_cases(detection_result_id);

-- Add RLS (Row Level Security) policies
ALTER TABLE dispute_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_detection_triggers ENABLE ROW LEVEL SECURITY;

-- RLS policies for dispute_cases
CREATE POLICY "Users can view their own dispute cases" ON dispute_cases
  FOR SELECT USING (auth.uid()::text = seller_id);

CREATE POLICY "Users can insert their own dispute cases" ON dispute_cases
  FOR INSERT WITH CHECK (auth.uid()::text = seller_id);

CREATE POLICY "Users can update their own dispute cases" ON dispute_cases
  FOR UPDATE USING (auth.uid()::text = seller_id);

-- RLS policies for dispute_automation_rules
CREATE POLICY "Users can view their own automation rules" ON dispute_automation_rules
  FOR SELECT USING (auth.uid()::text = seller_id);

CREATE POLICY "Users can insert their own automation rules" ON dispute_automation_rules
  FOR INSERT WITH CHECK (auth.uid()::text = seller_id);

CREATE POLICY "Users can update their own automation rules" ON dispute_automation_rules
  FOR UPDATE USING (auth.uid()::text = seller_id);

-- RLS policies for dispute_evidence
CREATE POLICY "Users can view evidence for their own cases" ON dispute_evidence
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM dispute_cases 
      WHERE dispute_cases.id = dispute_evidence.dispute_case_id 
      AND dispute_cases.seller_id = auth.uid()::text
    )
  );

CREATE POLICY "Users can insert evidence for their own cases" ON dispute_evidence
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM dispute_cases 
      WHERE dispute_cases.id = dispute_evidence.dispute_case_id 
      AND dispute_cases.seller_id = auth.uid()::text
    )
  );

-- RLS policies for dispute_audit_log
CREATE POLICY "Users can view audit logs for their own cases" ON dispute_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM dispute_cases 
      WHERE dispute_cases.id = dispute_audit_log.dispute_case_id 
      AND dispute_cases.seller_id = auth.uid()::text
    )
  );

-- RLS policies for detection_thresholds
CREATE POLICY "Users can view their own thresholds" ON detection_thresholds
  FOR SELECT USING (seller_id IS NULL OR auth.uid()::text = seller_id);

CREATE POLICY "Users can insert their own thresholds" ON detection_thresholds
  FOR INSERT WITH CHECK (auth.uid()::text = seller_id);

CREATE POLICY "Users can update their own thresholds" ON detection_thresholds
  FOR UPDATE USING (auth.uid()::text = seller_id);

-- RLS policies for detection_whitelist
CREATE POLICY "Users can view their own whitelist" ON detection_whitelist
  FOR SELECT USING (auth.uid()::text = seller_id);

CREATE POLICY "Users can insert their own whitelist" ON detection_whitelist
  FOR INSERT WITH CHECK (auth.uid()::text = seller_id);

CREATE POLICY "Users can update their own whitelist" ON detection_whitelist
  FOR UPDATE USING (auth.uid()::text = seller_id);

-- RLS policies for sync_detection_triggers
CREATE POLICY "Users can view their own sync triggers" ON sync_detection_triggers
  FOR SELECT USING (auth.uid()::text = seller_id);

CREATE POLICY "Users can insert their own sync triggers" ON sync_detection_triggers
  FOR INSERT WITH CHECK (auth.uid()::text = seller_id);

CREATE POLICY "Users can update their own sync triggers" ON sync_detection_triggers
  FOR UPDATE USING (auth.uid()::text = seller_id);

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_dispute_cases_updated_at 
  BEFORE UPDATE ON dispute_cases 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dispute_automation_rules_updated_at 
  BEFORE UPDATE ON dispute_automation_rules 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dispute_evidence_updated_at 
  BEFORE UPDATE ON dispute_evidence 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dispute_audit_log_updated_at 
  BEFORE UPDATE ON dispute_audit_log 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_detection_thresholds_updated_at 
  BEFORE UPDATE ON detection_thresholds 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_detection_whitelist_updated_at 
  BEFORE UPDATE ON detection_whitelist 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sync_detection_triggers_updated_at 
  BEFORE UPDATE ON sync_detection_triggers 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default detection thresholds
INSERT INTO detection_thresholds (seller_id, rule_type, threshold_value, threshold_operator, currency) VALUES
  (NULL, 'missing_unit', 5.00, 'gte', 'USD'),
  (NULL, 'overcharge', 2.00, 'gte', 'USD'),
  (NULL, 'damaged_stock', 5.00, 'gte', 'USD'),
  (NULL, 'incorrect_fee', 1.00, 'gte', 'USD'),
  (NULL, 'duplicate_charge', 0.01, 'gte', 'USD')
ON CONFLICT DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE dispute_cases IS 'Tracks reimbursement claim cases for detected anomalies';
COMMENT ON TABLE dispute_automation_rules IS 'Configurable rules for automating dispute creation and processing';
COMMENT ON TABLE dispute_evidence IS 'Stores evidence artifacts for dispute cases';
COMMENT ON TABLE dispute_audit_log IS 'Audit trail for all dispute case changes';
COMMENT ON TABLE detection_thresholds IS 'Configurable thresholds for anomaly detection rules';
COMMENT ON TABLE detection_whitelist IS 'Whitelist for excluding specific items from detection';
COMMENT ON TABLE sync_detection_triggers IS 'Tracks the sync-to-detection pipeline triggers';

COMMENT ON COLUMN dispute_cases.case_number IS 'Unique case identifier for tracking';
COMMENT ON COLUMN dispute_cases.claim_amount IS 'Amount being claimed for reimbursement';
COMMENT ON COLUMN dispute_cases.case_type IS 'Type of dispute case';
COMMENT ON COLUMN dispute_cases.provider IS 'External provider for the dispute';
COMMENT ON COLUMN dispute_cases.provider_case_id IS 'External provider case identifier';
COMMENT ON COLUMN dispute_cases.evidence_attachments IS 'JSON array of evidence file references';

COMMENT ON COLUMN dispute_automation_rules.conditions IS 'JSON conditions that trigger the rule';
COMMENT ON COLUMN dispute_automation_rules.actions IS 'JSON actions to take when rule is triggered';

COMMENT ON COLUMN detection_thresholds.threshold_value IS 'Threshold value for triggering detection';
COMMENT ON COLUMN detection_thresholds.threshold_operator IS 'Comparison operator for threshold evaluation';

COMMENT ON COLUMN detection_whitelist.whitelist_type IS 'Type of item to whitelist';
COMMENT ON COLUMN detection_whitelist.whitelist_value IS 'Value to whitelist (SKU, ASIN, etc.)';

COMMENT ON COLUMN sync_detection_triggers.trigger_type IS 'Type of sync that triggered detection';
COMMENT ON COLUMN sync_detection_triggers.metadata IS 'Additional metadata about the trigger';




-- ========================================
-- Migration: 006_add_deadline_tracking.sql
-- ========================================

-- Migration: Add deadline tracking for claims and detection results
-- This migration adds 60-day deadline tracking for Amazon claims

-- Add deadline tracking columns to detection_results
ALTER TABLE detection_results
  ADD COLUMN IF NOT EXISTS discovery_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deadline_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS days_remaining INTEGER,
  ADD COLUMN IF NOT EXISTS expiration_alert_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expired BOOLEAN DEFAULT FALSE;

-- Add deadline tracking columns to claims table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'claims') THEN
    ALTER TABLE claims
      ADD COLUMN IF NOT EXISTS discovery_date TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS deadline_date TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS days_remaining INTEGER,
      ADD COLUMN IF NOT EXISTS expiration_alert_sent BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS expired BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Create indexes for deadline queries
CREATE INDEX IF NOT EXISTS idx_detection_results_deadline_date ON detection_results(deadline_date) WHERE deadline_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detection_results_days_remaining ON detection_results(days_remaining) WHERE days_remaining IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_detection_results_expired ON detection_results(expired) WHERE expired = TRUE;

-- Add function to calculate deadline (60 days from discovery)
CREATE OR REPLACE FUNCTION calculate_claim_deadline(discovery_date TIMESTAMP WITH TIME ZONE)
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
  RETURN discovery_date + INTERVAL '60 days';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add function to calculate days remaining
CREATE OR REPLACE FUNCTION calculate_days_remaining(deadline_date TIMESTAMP WITH TIME ZONE)
RETURNS INTEGER AS $$
BEGIN
  RETURN GREATEST(0, EXTRACT(EPOCH FROM (deadline_date - NOW())) / 86400)::INTEGER;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create view for claims approaching deadline
CREATE OR REPLACE VIEW claims_approaching_deadline AS
SELECT 
  id,
  seller_id,
  anomaly_type,
  severity,
  estimated_value,
  currency,
  status,
  discovery_date,
  deadline_date,
  days_remaining,
  expiration_alert_sent,
  expired,
  created_at
FROM detection_results
WHERE 
  deadline_date IS NOT NULL
  AND expired = FALSE
  AND status IN ('pending', 'reviewed')
  AND days_remaining <= 7  -- 7 days or less remaining
ORDER BY days_remaining ASC, severity DESC;

COMMENT ON VIEW claims_approaching_deadline IS 'Claims with 7 days or less remaining until deadline';




-- ========================================
-- Migration: 006_add_prediction_fields.sql
-- ========================================

-- Migration: Add prediction fields to dispute_cases for payout estimator persistence

ALTER TABLE IF EXISTS dispute_cases
  ADD COLUMN IF NOT EXISTS expected_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS expected_paid_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2);

-- Optional indexes to support filtering/sorting by expected payout attributes
CREATE INDEX IF NOT EXISTS idx_dispute_cases_expected_paid_date ON dispute_cases(expected_paid_date);

-- Documentation
COMMENT ON COLUMN dispute_cases.expected_amount IS 'Predicted expected reimbursement amount for the dispute';
COMMENT ON COLUMN dispute_cases.expected_paid_date IS 'Predicted expected payout date for the dispute';
COMMENT ON COLUMN dispute_cases.confidence IS 'Confidence score (0..1) of the prediction';





-- ========================================
-- Migration: 007_evidence_engine.sql
-- ========================================

-- Migration: Evidence Engine core tables

-- Source connections (email, cloud storage)
CREATE TABLE IF NOT EXISTS evidence_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail','outlook','dropbox','gdrive','onedrive','s3','other')),
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','disconnected','error')),
  display_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ingested documents with extracted fields
CREATE TABLE IF NOT EXISTS evidence_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  source_id UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('invoice','shipping','po','other')),
  supplier_name TEXT,
  invoice_number TEXT,
  purchase_order_number TEXT,
  document_date TIMESTAMPTZ,
  currency TEXT,
  total_amount DECIMAL(12,2),
  file_url TEXT, -- link in Supabase Storage or external
  raw_text TEXT,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb, -- structured: items: [{sku, asin, quantity, unit_cost}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link evidence to disputes
CREATE TABLE IF NOT EXISTS dispute_evidence_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  evidence_document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
  relevance_score NUMERIC(4,3),
  matched_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Proof packets (generated PDF bundles)
CREATE TABLE IF NOT EXISTS proof_packets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  packet_url TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Smart prompts when ambiguity exists
CREATE TABLE IF NOT EXISTS smart_prompts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed','expired')),
  prompt_type TEXT NOT NULL DEFAULT 'evidence_selection',
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{id, label, evidence_document_id}]
  selected_option_id TEXT,
  related_dispute_id UUID REFERENCES dispute_cases(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  answered_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_evidence_sources_seller ON evidence_sources(seller_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_seller ON evidence_documents(seller_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_doc_date ON evidence_documents(document_date);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_dispute ON dispute_evidence_links(dispute_case_id);
CREATE INDEX IF NOT EXISTS idx_proof_packets_dispute ON proof_packets(dispute_case_id);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_seller ON smart_prompts(seller_id);

-- RLS enable
ALTER TABLE evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_prompts ENABLE ROW LEVEL SECURITY;

-- RLS policies (seller scoped)
CREATE POLICY evidence_sources_owner_select ON evidence_sources FOR SELECT USING (auth.uid()::text = seller_id);
CREATE POLICY evidence_sources_owner_insert ON evidence_sources FOR INSERT WITH CHECK (auth.uid()::text = seller_id);
CREATE POLICY evidence_sources_owner_update ON evidence_sources FOR UPDATE USING (auth.uid()::text = seller_id);

CREATE POLICY evidence_documents_owner_select ON evidence_documents FOR SELECT USING (auth.uid()::text = seller_id);
CREATE POLICY evidence_documents_owner_insert ON evidence_documents FOR INSERT WITH CHECK (auth.uid()::text = seller_id);
CREATE POLICY evidence_documents_owner_update ON evidence_documents FOR UPDATE USING (auth.uid()::text = seller_id);

CREATE POLICY dispute_evidence_links_dispute_scope ON dispute_evidence_links FOR SELECT USING (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = dispute_evidence_links.dispute_case_id AND d.seller_id = auth.uid()::text)
);
CREATE POLICY dispute_evidence_links_insert_scope ON dispute_evidence_links FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = dispute_evidence_links.dispute_case_id AND d.seller_id = auth.uid()::text)
);

CREATE POLICY proof_packets_owner_select ON proof_packets FOR SELECT USING (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = proof_packets.dispute_case_id AND d.seller_id = auth.uid()::text)
);
CREATE POLICY proof_packets_owner_insert ON proof_packets FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = proof_packets.dispute_case_id AND d.seller_id = auth.uid()::text)
);

CREATE POLICY smart_prompts_owner_select ON smart_prompts FOR SELECT USING (auth.uid()::text = seller_id);
CREATE POLICY smart_prompts_owner_insert ON smart_prompts FOR INSERT WITH CHECK (auth.uid()::text = seller_id);
CREATE POLICY smart_prompts_owner_update ON smart_prompts FOR UPDATE USING (auth.uid()::text = seller_id);





-- ========================================
-- Migration: 008_evidence_line_items.sql
-- ========================================

-- Migration: normalized line items for evidence documents plus indexes

CREATE TABLE IF NOT EXISTS evidence_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
  sku TEXT,
  asin TEXT,
  quantity INTEGER,
  unit_cost DECIMAL(12,4),
  currency TEXT,
  document_date TIMESTAMPTZ
);

-- Useful selective indexes
CREATE INDEX IF NOT EXISTS idx_evidence_line_items_seller_sku_date ON evidence_line_items(seller_id, sku, document_date);
CREATE INDEX IF NOT EXISTS idx_evidence_line_items_seller_asin_date ON evidence_line_items(seller_id, asin, document_date);
CREATE INDEX IF NOT EXISTS idx_evidence_line_items_doc ON evidence_line_items(document_id);

-- RLS enable and policies
ALTER TABLE evidence_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_line_items_owner_select ON evidence_line_items FOR SELECT USING (auth.uid()::text = seller_id);
CREATE POLICY evidence_line_items_owner_insert ON evidence_line_items FOR INSERT WITH CHECK (auth.uid()::text = seller_id);





-- ========================================
-- Migration: 009_evidence_documents_extracted_gin.sql
-- ========================================

-- Migration: JSONB GIN index on evidence_documents.extracted for fallback queries

-- Requires pg_trgm or jsonb_path_ops depending on strategy; here we use default GIN jsonb ops
CREATE INDEX IF NOT EXISTS idx_evidence_documents_extracted_gin ON evidence_documents USING GIN (extracted);





-- ========================================
-- Migration: 010_evidence_engine_extras.sql
-- ========================================

-- Migration: Evidence Engine DB layer extras (triggers, constraints, indexes, RLS updates)

-- Helper function for updated_at (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'update_updated_at_column' AND n.nspname = 'public'
  ) THEN
    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $function$ LANGUAGE plpgsql;
  END IF;
END$$;

-- Triggers for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_evidence_sources_updated_at'
  ) THEN
    CREATE TRIGGER trg_evidence_sources_updated_at
      BEFORE UPDATE ON evidence_sources
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_evidence_documents_updated_at'
  ) THEN
    CREATE TRIGGER trg_evidence_documents_updated_at
      BEFORE UPDATE ON evidence_documents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_smart_prompts_updated_at'
  ) THEN
    ALTER TABLE smart_prompts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE TRIGGER trg_smart_prompts_updated_at
      BEFORE UPDATE ON smart_prompts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;

-- Constraints
ALTER TABLE evidence_line_items
  ADD CONSTRAINT evidence_line_items_sku_or_asin_chk
  CHECK (sku IS NOT NULL OR asin IS NOT NULL);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_evidence_documents_seller_date ON evidence_documents(seller_id, document_date);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_invoice_number ON evidence_documents(invoice_number);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_supplier_name ON evidence_documents(supplier_name);

-- Prevent duplicate links between same dispute and document
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_evidence_link ON dispute_evidence_links(dispute_case_id, evidence_document_id);

-- RLS update policies (allow owner updates where appropriate)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE polname = 'evidence_line_items_owner_update'
  ) THEN
    CREATE POLICY evidence_line_items_owner_update ON evidence_line_items FOR UPDATE USING (auth.uid()::text = seller_id);
  END IF;
END$$;






-- ========================================
-- Migration: 011_evidence_engine_views.sql
-- ========================================

-- Migration: helper views for analytics/verification (optional)

CREATE OR REPLACE VIEW v_evidence_document_items AS
SELECT d.id AS document_id,
       d.seller_id,
       d.supplier_name,
       d.invoice_number,
       d.document_date,
       li.sku,
       li.asin,
       li.quantity,
       li.unit_cost
FROM evidence_documents d
LEFT JOIN evidence_line_items li ON li.document_id = d.id;

-- Simple view to see linked evidence per dispute
CREATE OR REPLACE VIEW v_dispute_evidence AS
SELECT l.dispute_case_id,
       l.evidence_document_id,
       l.relevance_score,
       d.supplier_name,
       d.invoice_number,
       d.document_date
FROM dispute_evidence_links l
JOIN evidence_documents d ON d.id = l.evidence_document_id;










-- ========================================
-- Migration: 011_evidence_ingestion_worker.sql
-- ========================================

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
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE evidence_documents
      ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_evidence_documents_user_id
      ON evidence_documents(user_id);
  END IF;

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




-- ========================================
-- Migration: 012_document_parsing_worker.sql
-- ========================================

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




-- ========================================
-- Migration: 013_evidence_matching_worker.sql
-- ========================================

-- Migration: Evidence Matching Worker Support
-- Adds error logging for Agent 6

-- Create evidence_matching_errors table
CREATE TABLE IF NOT EXISTS evidence_matching_errors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
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

-- Create indexes for evidence_matching_errors
CREATE INDEX IF NOT EXISTS idx_evidence_matching_errors_seller_id 
ON evidence_matching_errors(seller_id);

CREATE INDEX IF NOT EXISTS idx_evidence_matching_errors_created_at 
ON evidence_matching_errors(created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_matching_errors_resolved 
ON evidence_matching_errors(resolved) WHERE resolved = FALSE;

-- Enable RLS on evidence_matching_errors
ALTER TABLE evidence_matching_errors ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can only see their own matching errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'evidence_matching_errors' 
    AND policyname = 'evidence_matching_errors_owner_select'
  ) THEN
    CREATE POLICY evidence_matching_errors_owner_select
    ON evidence_matching_errors
    FOR SELECT
    USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'evidence_matching_errors' 
    AND policyname = 'evidence_matching_errors_owner_insert'
  ) THEN
    CREATE POLICY evidence_matching_errors_owner_insert
    ON evidence_matching_errors
    FOR INSERT
    WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'evidence_matching_errors' 
    AND policyname = 'evidence_matching_errors_owner_update'
  ) THEN
    CREATE POLICY evidence_matching_errors_owner_update
    ON evidence_matching_errors
    FOR UPDATE
    USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;
END $$;

-- Add match_confidence column to detection_results if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'detection_results' 
    AND column_name = 'match_confidence'
  ) THEN
    ALTER TABLE detection_results 
    ADD COLUMN match_confidence DECIMAL(5,4);
    
    CREATE INDEX IF NOT EXISTS idx_detection_results_match_confidence 
    ON detection_results(match_confidence);
  END IF;
END $$;




-- ========================================
-- Migration: 014_fix_parser_jobs.sql
-- ========================================

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



-- ========================================
-- Migration: 015_recoveries_worker.sql
-- ========================================

-- Migration: Add Recoveries Worker Support (Agent 8)
-- Adds recovery tracking, reconciliation, and lifecycle logging

-- Create recoveries table
CREATE TABLE IF NOT EXISTS recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  amazon_case_id TEXT,
  expected_amount DECIMAL(10,2) NOT NULL,
  actual_amount DECIMAL(10,2),
  discrepancy DECIMAL(10,2),
  discrepancy_type TEXT CHECK (discrepancy_type IN ('underpaid', 'overpaid')),
  reconciliation_status TEXT NOT NULL CHECK (reconciliation_status IN ('pending', 'reconciled', 'discrepancy', 'failed')),
  payout_date TIMESTAMPTZ,
  amazon_reimbursement_id TEXT,
  matched_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for recoveries
CREATE INDEX IF NOT EXISTS idx_recoveries_dispute_id ON recoveries(dispute_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_user_id ON recoveries(user_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_amazon_case_id ON recoveries(amazon_case_id);
CREATE INDEX IF NOT EXISTS idx_recoveries_reconciliation_status ON recoveries(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_recoveries_matched_at ON recoveries(matched_at);

-- Create recovery_lifecycle_logs table
CREATE TABLE IF NOT EXISTS recovery_lifecycle_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id UUID REFERENCES recoveries(id) ON DELETE CASCADE,
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('payout_detected', 'matched', 'reconciled', 'discrepancy_detected', 'error')),
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for recovery_lifecycle_logs
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_recovery_id ON recovery_lifecycle_logs(recovery_id);
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_dispute_id ON recovery_lifecycle_logs(dispute_id);
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_user_id ON recovery_lifecycle_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_event_type ON recovery_lifecycle_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_recovery_lifecycle_logs_created_at ON recovery_lifecycle_logs(created_at);

-- Add recovery_status column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'recovery_status'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN recovery_status TEXT DEFAULT 'pending' CHECK (recovery_status IN ('pending', 'detecting', 'matched', 'reconciled', 'discrepancy', 'failed'));
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_recovery_status ON dispute_cases(recovery_status);
  END IF;
END $$;

-- Add reconciled_at column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'reconciled_at'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN reconciled_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add actual_payout_amount column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'actual_payout_amount'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN actual_payout_amount DECIMAL(10,2);
  END IF;
END $$;

-- Add RLS policies for recoveries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recoveries' 
    AND policyname = 'recoveries_owner_select'
  ) THEN
    CREATE POLICY recoveries_owner_select ON recoveries
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recoveries' 
    AND policyname = 'recoveries_owner_insert'
  ) THEN
    CREATE POLICY recoveries_owner_insert ON recoveries
      FOR INSERT
      WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recoveries' 
    AND policyname = 'recoveries_owner_update'
  ) THEN
    CREATE POLICY recoveries_owner_update ON recoveries
      FOR UPDATE
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;
END $$;

-- Add RLS policies for recovery_lifecycle_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recovery_lifecycle_logs' 
    AND policyname = 'recovery_lifecycle_logs_owner_select'
  ) THEN
    CREATE POLICY recovery_lifecycle_logs_owner_select ON recovery_lifecycle_logs
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'recovery_lifecycle_logs' 
    AND policyname = 'recovery_lifecycle_logs_owner_insert'
  ) THEN
    CREATE POLICY recovery_lifecycle_logs_owner_insert ON recovery_lifecycle_logs
      FOR INSERT
      WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;
END $$;

-- Enable RLS on tables
ALTER TABLE recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_lifecycle_logs ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON TABLE recoveries IS 'Tracks payout detection and reconciliation for approved claims';
COMMENT ON TABLE recovery_lifecycle_logs IS 'Logs full lifecycle of recovery processing';
COMMENT ON COLUMN dispute_cases.recovery_status IS 'Status of recovery process: pending, detecting, matched, reconciled, discrepancy, failed';
COMMENT ON COLUMN dispute_cases.reconciled_at IS 'Timestamp when payout was reconciled';
COMMENT ON COLUMN dispute_cases.actual_payout_amount IS 'Actual amount received from Amazon';




-- ========================================
-- Migration: 015_refund_filing_worker.sql
-- ========================================

-- Migration: Add Refund Filing Worker Support (Agent 7)
-- Adds filing status tracking, error logging, and submission tracking

-- Add filing_status column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'filing_status'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN filing_status TEXT DEFAULT 'pending' CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed'));
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_filing_status ON dispute_cases(filing_status);
  END IF;
END $$;

-- Add retry_count column to dispute_cases if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN retry_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create refund_filing_errors table
CREATE TABLE IF NOT EXISTS refund_filing_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  submission_id UUID,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT FALSE
);

-- Create indexes for refund_filing_errors
CREATE INDEX IF NOT EXISTS idx_refund_filing_errors_user_id ON refund_filing_errors(user_id);
CREATE INDEX IF NOT EXISTS idx_refund_filing_errors_dispute_id ON refund_filing_errors(dispute_id);
CREATE INDEX IF NOT EXISTS idx_refund_filing_errors_created_at ON refund_filing_errors(created_at);
CREATE INDEX IF NOT EXISTS idx_refund_filing_errors_resolved ON refund_filing_errors(resolved);

-- Create dispute_submissions table if it doesn't exist
CREATE TABLE IF NOT EXISTS dispute_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  user_id TEXT,
  submission_id TEXT,
  amazon_case_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'open', 'in_progress', 'approved', 'denied', 'rejected', 'closed', 'failed')),
  last_status_check TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for dispute_submissions
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_dispute_id ON dispute_submissions(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_submission_id ON dispute_submissions(submission_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_amazon_case_id ON dispute_submissions(amazon_case_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_status ON dispute_submissions(status);

-- Add RLS policies for refund_filing_errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'refund_filing_errors' 
    AND policyname = 'refund_filing_errors_owner_select'
  ) THEN
    CREATE POLICY refund_filing_errors_owner_select ON refund_filing_errors
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'refund_filing_errors' 
    AND policyname = 'refund_filing_errors_owner_insert'
  ) THEN
    CREATE POLICY refund_filing_errors_owner_insert ON refund_filing_errors
      FOR INSERT
      WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;
END $$;

-- Add RLS policies for dispute_submissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'dispute_submissions' 
    AND policyname = 'dispute_submissions_owner_select'
  ) THEN
    CREATE POLICY dispute_submissions_owner_select ON dispute_submissions
      FOR SELECT
      USING (
        CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
        OR EXISTS (
          SELECT 1 FROM dispute_cases dc
          WHERE dc.id = dispute_submissions.dispute_id
          AND CAST(auth.uid() AS TEXT) = CAST(dc.seller_id AS TEXT)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'dispute_submissions' 
    AND policyname = 'dispute_submissions_owner_insert'
  ) THEN
    CREATE POLICY dispute_submissions_owner_insert ON dispute_submissions
      FOR INSERT
      WITH CHECK (
        CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
        OR EXISTS (
          SELECT 1 FROM dispute_cases dc
          WHERE dc.id = dispute_submissions.dispute_id
          AND CAST(auth.uid() AS TEXT) = CAST(dc.seller_id AS TEXT)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'dispute_submissions' 
    AND policyname = 'dispute_submissions_owner_update'
  ) THEN
    CREATE POLICY dispute_submissions_owner_update ON dispute_submissions
      FOR UPDATE
      USING (
        CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT)
        OR EXISTS (
          SELECT 1 FROM dispute_cases dc
          WHERE dc.id = dispute_submissions.dispute_id
          AND CAST(auth.uid() AS TEXT) = CAST(dc.seller_id AS TEXT)
        )
      );
  END IF;
END $$;

-- Enable RLS on tables
ALTER TABLE refund_filing_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_submissions ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON TABLE refund_filing_errors IS 'Logs errors from refund filing operations';
COMMENT ON TABLE dispute_submissions IS 'Tracks dispute submissions to Amazon SP-API';
COMMENT ON COLUMN dispute_cases.filing_status IS 'Status of filing process: pending, filing, filed, retrying, failed';
COMMENT ON COLUMN dispute_cases.retry_count IS 'Number of filing retry attempts';




-- ========================================
-- Migration: 016_billing_worker.sql
-- ========================================

-- Migration: Add Billing Worker Support (Agent 9)
-- Adds billing tracking, transactions, and error logging

-- Create billing_transactions table
CREATE TABLE IF NOT EXISTS billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  recovery_id UUID REFERENCES recoveries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  amount_recovered_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL,
  seller_payout_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  stripe_transaction_id INTEGER, -- FK to stripe-payments StripeTransaction (optional, may be in different DB)
  stripe_payment_intent_id TEXT,
  billing_status TEXT NOT NULL CHECK (billing_status IN ('pending', 'charged', 'failed', 'refunded')),
  idempotency_key TEXT UNIQUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for billing_transactions
CREATE INDEX IF NOT EXISTS idx_billing_transactions_dispute_id ON billing_transactions(dispute_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_recovery_id ON billing_transactions(recovery_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_user_id ON billing_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_billing_status ON billing_transactions(billing_status);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_idempotency_key ON billing_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_created_at ON billing_transactions(created_at);

-- Create billing_errors table
CREATE TABLE IF NOT EXISTS billing_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID REFERENCES dispute_cases(id) ON DELETE CASCADE,
  recovery_id UUID REFERENCES recoveries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT FALSE
);

-- Create indexes for billing_errors
CREATE INDEX IF NOT EXISTS idx_billing_errors_dispute_id ON billing_errors(dispute_id);
CREATE INDEX IF NOT EXISTS idx_billing_errors_recovery_id ON billing_errors(recovery_id);
CREATE INDEX IF NOT EXISTS idx_billing_errors_user_id ON billing_errors(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_errors_error_type ON billing_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_billing_errors_resolved ON billing_errors(resolved);
CREATE INDEX IF NOT EXISTS idx_billing_errors_created_at ON billing_errors(created_at);

-- Add billing columns to dispute_cases table
DO $$ 
BEGIN
  -- Add billing_status column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'billing_status'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN billing_status TEXT CHECK (billing_status IN ('pending', 'charged', 'failed', 'refunded'));
  END IF;

  -- Add billing_transaction_id column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'billing_transaction_id'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN billing_transaction_id UUID REFERENCES billing_transactions(id) ON DELETE SET NULL;
  END IF;

  -- Add platform_fee_cents column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'platform_fee_cents'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN platform_fee_cents INTEGER;
  END IF;

  -- Add seller_payout_cents column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'seller_payout_cents'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN seller_payout_cents INTEGER;
  END IF;

  -- Add billed_at column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'billed_at'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN billed_at TIMESTAMPTZ;
  END IF;

  -- Add billing_retry_count column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_cases' AND column_name = 'billing_retry_count'
  ) THEN
    ALTER TABLE dispute_cases ADD COLUMN billing_retry_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create indexes for new columns on dispute_cases
CREATE INDEX IF NOT EXISTS idx_dispute_cases_billing_status ON dispute_cases(billing_status);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_billing_transaction_id ON dispute_cases(billing_transaction_id);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_billed_at ON dispute_cases(billed_at);

-- Add RLS policies for billing_transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'billing_transactions' 
    AND policyname = 'billing_transactions_owner_select'
  ) THEN
    CREATE POLICY billing_transactions_owner_select ON billing_transactions
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'billing_transactions' 
    AND policyname = 'billing_transactions_service_role_all'
  ) THEN
    CREATE POLICY billing_transactions_service_role_all ON billing_transactions
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Add RLS policies for billing_errors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'billing_errors' 
    AND policyname = 'billing_errors_owner_select'
  ) THEN
    CREATE POLICY billing_errors_owner_select ON billing_errors
      FOR SELECT
      USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'billing_errors' 
    AND policyname = 'billing_errors_service_role_all'
  ) THEN
    CREATE POLICY billing_errors_service_role_all ON billing_errors
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Enable RLS on billing_transactions
ALTER TABLE billing_transactions ENABLE ROW LEVEL SECURITY;

-- Enable RLS on billing_errors
ALTER TABLE billing_errors ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON TABLE billing_transactions IS 'Tracks all billing transactions for recovered amounts';
COMMENT ON TABLE billing_errors IS 'Logs billing errors and retry attempts';
COMMENT ON COLUMN dispute_cases.billing_status IS 'Status of billing: pending, charged, failed, refunded';
COMMENT ON COLUMN dispute_cases.billing_transaction_id IS 'Reference to billing_transactions table';
COMMENT ON COLUMN dispute_cases.platform_fee_cents IS 'Platform fee (20%) in cents';
COMMENT ON COLUMN dispute_cases.seller_payout_cents IS 'Seller payout (80%) in cents';
COMMENT ON COLUMN dispute_cases.billed_at IS 'Timestamp when billing occurred';
COMMENT ON COLUMN dispute_cases.billing_retry_count IS 'Number of billing retry attempts';




-- ========================================
-- Migration: 016_ensure_parser_jobs_user_id.sql
-- ========================================

-- Migration: Ensure parser_jobs has user_id column
-- Fixes "column user_id of relation parser_jobs does not exist" error

DO $$ 
BEGIN
  -- Add user_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'user_id') THEN
    ALTER TABLE parser_jobs ADD COLUMN user_id UUID;
    
    -- Add index for performance
    CREATE INDEX IF NOT EXISTS idx_parser_jobs_user_id ON parser_jobs(user_id);
  END IF;
END $$;



-- ========================================
-- Migration: 017_ensure_parser_jobs_columns.sql
-- ========================================

-- Migration: Ensure parser_jobs has all required columns
-- Fixes missing column errors for parser_type, started_at, etc.

DO $$ 
BEGIN
  -- Add parser_type if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'parser_type') THEN
    ALTER TABLE parser_jobs ADD COLUMN parser_type TEXT NOT NULL DEFAULT 'pdf';
    CREATE INDEX IF NOT EXISTS idx_parser_jobs_parser_type ON parser_jobs(parser_type);
  END IF;

  -- Add started_at if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'started_at') THEN
    ALTER TABLE parser_jobs ADD COLUMN started_at TIMESTAMPTZ;
  END IF;

   -- Add completed_at if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'completed_at') THEN
    ALTER TABLE parser_jobs ADD COLUMN completed_at TIMESTAMPTZ;
  END IF;

  -- Add status if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'status') THEN
    ALTER TABLE parser_jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
    CREATE INDEX IF NOT EXISTS idx_parser_jobs_status ON parser_jobs(status);
  END IF;
END $$;



-- ========================================
-- Migration: 017_notifications_worker.sql
-- ========================================

-- Migration: Add Notifications Worker Support (Agent 10)
-- Creates notifications table if it doesn't exist and adds missing event types

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create notifications table if it doesn't exist
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'sent',
        'delivered',
        'read',
        'failed',
        'expired'
    )),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN (
        'low',
        'normal',
        'high',
        'urgent'
    )),
    channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN (
        'in_app',
        'email',
        'both'
    )),
    payload JSONB DEFAULT '{}'::jsonb,
    read_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update notifications table to include new event types
DO $$ 
BEGIN
  -- Drop existing CHECK constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'notifications_type_check' 
    AND table_name = 'notifications'
  ) THEN
    ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
  END IF;

  -- Add new CHECK constraint with all event types
  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
    CHECK (type IN (
      'claim_detected',
      'evidence_found',
      'case_filed',
      'refund_approved',
      'funds_deposited',
      'integration_completed',
      'payment_processed',
      'sync_completed',
      'discrepancy_found',
      'system_alert',
      'user_action_required'
    ));
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(channel);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type ON notifications(user_id, type);
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Add index for pending notifications (for worker queries)
CREATE INDEX IF NOT EXISTS idx_notifications_status_created 
ON notifications(status, created_at) 
WHERE status = 'pending';

-- Enable Row Level Security (RLS)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (drop existing if they exist, then recreate)
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can insert their own notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can delete their own notifications" ON notifications;
END $$;

-- Create RLS policies with explicit type casting
CREATE POLICY "Users can view their own notifications" ON notifications
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can insert their own notifications" ON notifications
    FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can update their own notifications" ON notifications
    FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can delete their own notifications" ON notifications
    FOR DELETE USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_update_notifications_updated_at ON notifications;
CREATE TRIGGER trigger_update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_notifications_updated_at();

-- Add comments
COMMENT ON TABLE notifications IS 'Stores user notifications for the notification system';
COMMENT ON COLUMN notifications.id IS 'Unique identifier for the notification';
COMMENT ON COLUMN notifications.user_id IS 'ID of the user who owns this notification';
COMMENT ON COLUMN notifications.type IS 'Type of notification: claim_detected, evidence_found, case_filed, refund_approved, funds_deposited, integration_completed, payment_processed, sync_completed, discrepancy_found, system_alert, user_action_required';
COMMENT ON COLUMN notifications.title IS 'Notification title';
COMMENT ON COLUMN notifications.message IS 'Notification message content';
COMMENT ON COLUMN notifications.status IS 'Current status of the notification';
COMMENT ON COLUMN notifications.priority IS 'Priority level of the notification';
COMMENT ON COLUMN notifications.channel IS 'Delivery channel(s) for the notification';
COMMENT ON COLUMN notifications.payload IS 'Additional metadata for the notification';
COMMENT ON COLUMN notifications.read_at IS 'Timestamp when notification was read';
COMMENT ON COLUMN notifications.delivered_at IS 'Timestamp when notification was delivered';
COMMENT ON COLUMN notifications.expires_at IS 'Timestamp when notification expires';
COMMENT ON COLUMN notifications.created_at IS 'Timestamp when notification was created';
COMMENT ON COLUMN notifications.updated_at IS 'Timestamp when notification was last updated';

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;

-- Verify the update
SELECT 
    constraint_name,
    check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'notifications_type_check';




-- ========================================
-- Migration: 018_learning_worker.sql
-- ========================================

-- Migration: Add Learning Worker Support (Agent 11)
-- Creates tables for agent event logging, learning metrics, and insights

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create agent_events table for event-level logging from all agents
CREATE TABLE IF NOT EXISTS agent_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    agent TEXT NOT NULL CHECK (agent IN (
        'evidence_ingestion',
        'document_parsing',
        'evidence_matching',
        'refund_filing',
        'recoveries',
        'billing',
        'learning'
    )),
    event_type TEXT NOT NULL,
    success BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create learning_metrics table for model performance tracking
CREATE TABLE IF NOT EXISTS learning_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT,
    agent TEXT,
    metric_name TEXT NOT NULL,
    metric_value DECIMAL(10,4) NOT NULL,
    metric_type TEXT NOT NULL CHECK (metric_type IN (
        'success_rate',
        'precision',
        'recall',
        'accuracy',
        'f1_score',
        'threshold',
        'model_version'
    )),
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create threshold_optimizations table for threshold update history
CREATE TABLE IF NOT EXISTS threshold_optimizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    threshold_type TEXT NOT NULL CHECK (threshold_type IN (
        'auto_submit',
        'smart_prompt',
        'hold'
    )),
    old_value DECIMAL(5,4) NOT NULL,
    new_value DECIMAL(5,4) NOT NULL,
    reason TEXT,
    expected_improvement DECIMAL(5,4),
    actual_improvement DECIMAL(5,4),
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create model_retraining_history table for retraining records
CREATE TABLE IF NOT EXISTS model_retraining_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN (
        'scheduled',
        'rejection_threshold',
        'success_rate_threshold',
        'manual'
    )),
    old_model_version TEXT,
    new_model_version TEXT,
    old_accuracy DECIMAL(5,4),
    new_accuracy DECIMAL(5,4),
    improvement DECIMAL(5,4),
    training_samples INTEGER,
    event_count INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'training',
        'completed',
        'failed'
    )),
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create learning_insights table for generated insights
CREATE TABLE IF NOT EXISTS learning_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    insights JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_agent_events_user_id ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON agent_events(agent);
CREATE INDEX IF NOT EXISTS idx_agent_events_event_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_success ON agent_events(success);
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_user_agent ON agent_events(user_id, agent);
CREATE INDEX IF NOT EXISTS idx_agent_events_user_created ON agent_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_metrics_user_id ON learning_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_metrics_agent ON learning_metrics(agent);
CREATE INDEX IF NOT EXISTS idx_learning_metrics_metric_name ON learning_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_learning_metrics_created_at ON learning_metrics(created_at);

CREATE INDEX IF NOT EXISTS idx_threshold_optimizations_user_id ON threshold_optimizations(user_id);
CREATE INDEX IF NOT EXISTS idx_threshold_optimizations_threshold_type ON threshold_optimizations(threshold_type);
CREATE INDEX IF NOT EXISTS idx_threshold_optimizations_applied_at ON threshold_optimizations(applied_at);

CREATE INDEX IF NOT EXISTS idx_model_retraining_history_user_id ON model_retraining_history(user_id);
CREATE INDEX IF NOT EXISTS idx_model_retraining_history_status ON model_retraining_history(status);
CREATE INDEX IF NOT EXISTS idx_model_retraining_history_started_at ON model_retraining_history(started_at);

CREATE INDEX IF NOT EXISTS idx_learning_insights_user_id ON learning_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_insights_generated_at ON learning_insights(generated_at);

-- Enable Row Level Security (RLS)
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE threshold_optimizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_retraining_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_insights ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (drop existing if they exist, then recreate)
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Users can view their own agent events" ON agent_events;
  DROP POLICY IF EXISTS "Users can view their own learning metrics" ON learning_metrics;
  DROP POLICY IF EXISTS "Users can view their own threshold optimizations" ON threshold_optimizations;
  DROP POLICY IF EXISTS "Users can view their own retraining history" ON model_retraining_history;
  DROP POLICY IF EXISTS "Users can view their own learning insights" ON learning_insights;
END $$;

-- Create RLS policies with explicit type casting
CREATE POLICY "Users can view their own agent events" ON agent_events
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can view their own learning metrics" ON learning_metrics
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can view their own threshold optimizations" ON threshold_optimizations
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can view their own retraining history" ON model_retraining_history
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can view their own learning insights" ON learning_insights
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

-- Add comments
COMMENT ON TABLE agent_events IS 'Event-level logging from all agents (4-10) for continuous learning';
COMMENT ON COLUMN agent_events.agent IS 'Agent type: evidence_ingestion, document_parsing, evidence_matching, refund_filing, recoveries, billing';
COMMENT ON COLUMN agent_events.event_type IS 'Type of event (e.g., ingestion_completed, parsing_failed, case_approved)';
COMMENT ON COLUMN agent_events.metadata IS 'Rich metadata: timestamps, confidence scores, errors, outcomes, performance metrics';

COMMENT ON TABLE learning_metrics IS 'Model performance metrics and success rates per agent';
COMMENT ON COLUMN learning_metrics.metric_type IS 'Type of metric: success_rate, precision, recall, accuracy, f1_score, threshold, model_version';

COMMENT ON TABLE threshold_optimizations IS 'History of threshold adjustments for dynamic optimization';
COMMENT ON COLUMN threshold_optimizations.threshold_type IS 'Type of threshold: auto_submit, smart_prompt, hold';

COMMENT ON TABLE model_retraining_history IS 'Records of model retraining triggered by learning worker';
COMMENT ON COLUMN model_retraining_history.trigger_type IS 'What triggered retraining: scheduled, rejection_threshold, success_rate_threshold, manual';

COMMENT ON TABLE learning_insights IS 'Generated insights and recommendations for users';

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON threshold_optimizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON model_retraining_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_insights TO authenticated;

-- Verify the tables were created successfully
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name IN ('agent_events', 'learning_metrics', 'threshold_optimizations', 'model_retraining_history', 'learning_insights')
ORDER BY table_name, ordinal_position;




-- ========================================
-- Migration: 019_agent11_full_implementation.sql
-- ========================================

-- Migration: Agent 11 Full Implementation - 7-Layer Adaptive Learning System
-- Creates tables for rules engine, feature flags, schema monitoring, rejection patterns, and manual review

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- LAYER 1: SP-API Schema Monitoring
-- ============================================

-- Table to track SP-API schema changes
CREATE TABLE IF NOT EXISTS schema_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_name TEXT NOT NULL,                    -- e.g., 'sellers', 'orders', 'fba-inventory'
    endpoint TEXT NOT NULL,                    -- e.g., '/fba/inbound/v0/shipments'
    change_type TEXT NOT NULL CHECK (change_type IN (
        'new_field',
        'deprecated_field',
        'new_endpoint',
        'deprecated_endpoint',
        'new_claim_type',
        'schema_change'
    )),
    field_name TEXT,                           -- Affected field name
    old_schema JSONB,                          -- Previous schema snapshot
    new_schema JSONB,                          -- New schema snapshot
    description TEXT,                          -- Human-readable description
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table to store SP-API schema snapshots
CREATE TABLE IF NOT EXISTS schema_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_name TEXT NOT NULL,
    version TEXT,
    schema_hash TEXT NOT NULL,                 -- Hash for quick comparison
    full_schema JSONB NOT NULL,                -- Complete schema
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(api_name, schema_hash)
);

-- ============================================
-- LAYER 2: Rules Engine as Config
-- ============================================

-- Table for claim rules (hot-updatable without code changes)
CREATE TABLE IF NOT EXISTS claim_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_name TEXT NOT NULL UNIQUE,
    claim_type TEXT NOT NULL,                  -- e.g., 'lost_inventory', 'damaged_item', 'overcharge'
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'detection',                           -- For claim detection
        'validation',                          -- For claim validation
        'evidence_requirement',                -- For evidence requirements
        'threshold',                           -- For confidence thresholds
        'filing',                              -- For filing requirements
        'deadline'                             -- For deadline calculations
    )),
    conditions JSONB NOT NULL DEFAULT '{}',    -- Rule conditions (e.g., {"amount_min": 10, "days_since_shipment": 30})
    actions JSONB NOT NULL DEFAULT '{}',       -- Actions to take when rule matches
    priority INTEGER DEFAULT 0,                -- Higher = checked first
    is_active BOOLEAN DEFAULT TRUE,
    version INTEGER DEFAULT 1,
    created_by TEXT,
    updated_by TEXT,
    effective_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    effective_until TIMESTAMP WITH TIME ZONE,  -- NULL = no expiry
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for evidence mappings (what evidence is needed per claim type)
CREATE TABLE IF NOT EXISTS evidence_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_type TEXT NOT NULL,
    evidence_type TEXT NOT NULL,               -- e.g., 'invoice', 'pod', 'tracking', 'photo'
    requirement_level TEXT NOT NULL CHECK (requirement_level IN (
        'mandatory',                           -- Must have
        'recommended',                         -- Should have
        'optional',                            -- Nice to have
        'conditional'                          -- Depends on other factors
    )),
    conditions JSONB DEFAULT '{}',             -- Conditions for when this evidence is needed
    weight DECIMAL(3,2) DEFAULT 1.00,          -- Weight for matching score (0.00-1.00)
    description TEXT,
    amazon_field_name TEXT,                    -- Amazon's field name for this evidence
    is_active BOOLEAN DEFAULT TRUE,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(claim_type, evidence_type)
);

-- ============================================
-- LAYER 5: Auto-Audit & Error Classification
-- ============================================

-- Table for categorized rejection patterns
CREATE TABLE IF NOT EXISTS rejection_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_name TEXT NOT NULL UNIQUE,
    amazon_reason_text TEXT,                   -- Exact text from Amazon
    amazon_reason_code TEXT,                   -- Amazon's reason code if any
    category TEXT NOT NULL CHECK (category IN (
        'missing_evidence',
        'wrong_amount',
        'expired_claim',
        'duplicate_claim',
        'ineligible_item',
        'insufficient_proof',
        'wrong_format',
        'policy_violation',
        'other'
    )),
    subcategory TEXT,                          -- More specific categorization
    is_fixable BOOLEAN DEFAULT TRUE,           -- Can this rejection be fixed?
    fix_action TEXT,                           -- What to do to fix it
    required_evidence TEXT[],                  -- Evidence types needed to fix
    occurrence_count INTEGER DEFAULT 0,        -- How often this pattern occurs
    success_after_fix_rate DECIMAL(5,4),       -- Success rate after applying fix
    auto_update_rule BOOLEAN DEFAULT FALSE,    -- Should this auto-update rules?
    rule_update_applied BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for individual rejections (for learning)
CREATE TABLE IF NOT EXISTS claim_rejections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    dispute_id UUID,                           -- Reference to disputes table
    amazon_case_id TEXT,
    claim_type TEXT,
    rejection_reason TEXT NOT NULL,
    rejection_pattern_id UUID REFERENCES rejection_patterns(id),
    claim_amount DECIMAL(12,2),
    currency TEXT DEFAULT 'USD',
    evidence_provided TEXT[],                  -- What evidence was provided
    evidence_missing TEXT[],                   -- What evidence was missing (if detected)
    fix_attempted BOOLEAN DEFAULT FALSE,
    fix_successful BOOLEAN,
    resubmission_count INTEGER DEFAULT 0,
    final_outcome TEXT CHECK (final_outcome IN ('fixed', 'abandoned', 'escalated', 'pending')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- LAYER 6: Canary + Feature Flags
-- ============================================

-- Table for feature flags with gradual rollout
CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_name TEXT NOT NULL UNIQUE,
    description TEXT,
    flag_type TEXT NOT NULL CHECK (flag_type IN (
        'rule_update',                         -- New claim rule
        'threshold_change',                    -- Threshold adjustment
        'evidence_requirement',                -- New evidence requirement
        'feature',                             -- General feature flag
        'experiment'                           -- A/B test
    )),
    is_enabled BOOLEAN DEFAULT FALSE,
    rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    target_users TEXT[],                       -- Specific users to include
    exclude_users TEXT[],                      -- Specific users to exclude
    conditions JSONB DEFAULT '{}',             -- Additional conditions for activation
    payload JSONB DEFAULT '{}',                -- Flag payload/configuration
    metrics JSONB DEFAULT '{}',                -- Tracked metrics for this flag
    success_metric TEXT,                       -- Primary success metric to track
    success_threshold DECIMAL(5,4),            -- Threshold for auto-expansion
    auto_expand BOOLEAN DEFAULT FALSE,         -- Auto-expand on success?
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE        -- Optional expiry
);

-- Table for feature flag evaluation history
CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id UUID REFERENCES feature_flags(id),
    flag_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    evaluated_to BOOLEAN NOT NULL,             -- TRUE = enabled, FALSE = disabled
    reason TEXT,                               -- Why it evaluated this way
    context JSONB DEFAULT '{}',                -- Context at evaluation time
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for feature flag metrics
CREATE TABLE IF NOT EXISTS feature_flag_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id UUID REFERENCES feature_flags(id),
    flag_name TEXT NOT NULL,
    metric_name TEXT NOT NULL,                 -- e.g., 'approval_rate', 'rejection_rate'
    metric_value DECIMAL(10,4) NOT NULL,
    sample_size INTEGER,
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    is_control_group BOOLEAN DEFAULT FALSE,   -- Control vs treatment
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- LAYER 7: Human-in-the-Loop Backstop
-- ============================================

-- Table for manual review queue
CREATE TABLE IF NOT EXISTS manual_review_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    dispute_id UUID,
    amazon_case_id TEXT,
    review_type TEXT NOT NULL CHECK (review_type IN (
        'repeated_rejection',                  -- Multiple rejections on same claim
        'low_confidence',                      -- Low confidence match
        'new_pattern',                         -- Unknown rejection pattern
        'edge_case',                           -- Unusual case
        'escalation',                          -- User escalated
        'quality_check'                        -- Random quality check
    )),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',
        'assigned',
        'in_review',
        'completed',
        'archived'
    )),
    assigned_to TEXT,                          -- Analyst handling this
    context JSONB DEFAULT '{}',                -- All relevant context
    rejection_history JSONB DEFAULT '[]',      -- History of rejections
    analyst_notes TEXT,
    analyst_correction JSONB,                  -- What the analyst corrected
    correction_type TEXT CHECK (correction_type IN (
        'rule_update',                         -- Update a rule
        'evidence_mapping',                    -- Update evidence mapping
        'threshold_adjustment',                -- Adjust threshold
        'new_pattern',                         -- Register new pattern
        'no_action',                           -- No correction needed
        'escalate'                             -- Needs further escalation
    )),
    fed_back_to_learning BOOLEAN DEFAULT FALSE,
    learning_event_id UUID,                    -- Reference to agent_events if fed back
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Table for analyst corrections history
CREATE TABLE IF NOT EXISTS analyst_corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID REFERENCES manual_review_queue(id),
    analyst_id TEXT NOT NULL,
    correction_type TEXT NOT NULL,
    before_state JSONB,                        -- State before correction
    after_state JSONB,                         -- State after correction
    reasoning TEXT,                            -- Why this correction was made
    impact_assessment TEXT,                    -- Expected impact
    was_applied BOOLEAN DEFAULT FALSE,
    applied_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Schema changes indexes
CREATE INDEX IF NOT EXISTS idx_schema_changes_api_name ON schema_changes(api_name);
CREATE INDEX IF NOT EXISTS idx_schema_changes_change_type ON schema_changes(change_type);
CREATE INDEX IF NOT EXISTS idx_schema_changes_detected_at ON schema_changes(detected_at);
CREATE INDEX IF NOT EXISTS idx_schema_changes_acknowledged ON schema_changes(acknowledged);

-- Claim rules indexes
CREATE INDEX IF NOT EXISTS idx_claim_rules_claim_type ON claim_rules(claim_type);
CREATE INDEX IF NOT EXISTS idx_claim_rules_rule_type ON claim_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_claim_rules_is_active ON claim_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_claim_rules_priority ON claim_rules(priority DESC);

-- Evidence mappings indexes
CREATE INDEX IF NOT EXISTS idx_evidence_mappings_claim_type ON evidence_mappings(claim_type);
CREATE INDEX IF NOT EXISTS idx_evidence_mappings_evidence_type ON evidence_mappings(evidence_type);
CREATE INDEX IF NOT EXISTS idx_evidence_mappings_is_active ON evidence_mappings(is_active);

-- Rejection patterns indexes
CREATE INDEX IF NOT EXISTS idx_rejection_patterns_category ON rejection_patterns(category);
CREATE INDEX IF NOT EXISTS idx_rejection_patterns_is_fixable ON rejection_patterns(is_fixable);

-- Claim rejections indexes
CREATE INDEX IF NOT EXISTS idx_claim_rejections_user_id ON claim_rejections(user_id);
CREATE INDEX IF NOT EXISTS idx_claim_rejections_dispute_id ON claim_rejections(dispute_id);
CREATE INDEX IF NOT EXISTS idx_claim_rejections_pattern_id ON claim_rejections(rejection_pattern_id);
CREATE INDEX IF NOT EXISTS idx_claim_rejections_created_at ON claim_rejections(created_at);

-- Feature flags indexes
CREATE INDEX IF NOT EXISTS idx_feature_flags_flag_name ON feature_flags(flag_name);
CREATE INDEX IF NOT EXISTS idx_feature_flags_flag_type ON feature_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_feature_flags_is_enabled ON feature_flags(is_enabled);

-- Feature flag evaluations indexes
CREATE INDEX IF NOT EXISTS idx_ff_evaluations_flag_id ON feature_flag_evaluations(flag_id);
CREATE INDEX IF NOT EXISTS idx_ff_evaluations_user_id ON feature_flag_evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_ff_evaluations_created_at ON feature_flag_evaluations(created_at);

-- Feature flag metrics indexes
CREATE INDEX IF NOT EXISTS idx_ff_metrics_flag_id ON feature_flag_metrics(flag_id);
CREATE INDEX IF NOT EXISTS idx_ff_metrics_metric_name ON feature_flag_metrics(metric_name);

-- Manual review queue indexes
CREATE INDEX IF NOT EXISTS idx_manual_review_user_id ON manual_review_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_review_status ON manual_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_manual_review_priority ON manual_review_queue(priority);
CREATE INDEX IF NOT EXISTS idx_manual_review_review_type ON manual_review_queue(review_type);
CREATE INDEX IF NOT EXISTS idx_manual_review_created_at ON manual_review_queue(created_at);

-- Analyst corrections indexes
CREATE INDEX IF NOT EXISTS idx_analyst_corrections_review_id ON analyst_corrections(review_id);
CREATE INDEX IF NOT EXISTS idx_analyst_corrections_analyst_id ON analyst_corrections(analyst_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE schema_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejection_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_corrections ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Service can read schema changes" ON schema_changes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can read schema snapshots" ON schema_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can read claim rules" ON claim_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can read evidence mappings" ON evidence_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can read rejection patterns" ON rejection_patterns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view their own rejections" ON claim_rejections FOR SELECT TO authenticated 
    USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
CREATE POLICY "Service can read feature flags" ON feature_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view their own flag evaluations" ON feature_flag_evaluations FOR SELECT TO authenticated 
    USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
CREATE POLICY "Service can read flag metrics" ON feature_flag_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view their own review queue items" ON manual_review_queue FOR SELECT TO authenticated 
    USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
CREATE POLICY "Analysts can view corrections" ON analyst_corrections FOR SELECT TO authenticated USING (true);

-- ============================================
-- SEED INITIAL DATA
-- ============================================

-- Seed common rejection patterns
INSERT INTO rejection_patterns (pattern_name, amazon_reason_text, category, subcategory, is_fixable, fix_action, required_evidence) VALUES
('missing_pod', 'Proof of delivery required', 'missing_evidence', 'pod', true, 'Upload proof of delivery document', ARRAY['pod', 'tracking']),
('missing_invoice', 'Invoice not provided', 'missing_evidence', 'invoice', true, 'Upload invoice document', ARRAY['invoice']),
('wrong_amount', 'Claimed amount does not match records', 'wrong_amount', 'mismatch', true, 'Verify and correct claim amount', ARRAY['invoice']),
('expired_claim', 'Claim submitted after deadline', 'expired_claim', 'time_limit', false, 'Cannot be fixed - claim expired', NULL),
('duplicate_claim', 'This item has already been claimed', 'duplicate_claim', 'already_filed', false, 'Check existing claims', NULL),
('ineligible_fba', 'Item not eligible for FBA reimbursement', 'ineligible_item', 'fba_policy', false, 'Review FBA eligibility requirements', NULL),
('insufficient_proof', 'Additional documentation required', 'insufficient_proof', 'general', true, 'Provide additional supporting documents', ARRAY['invoice', 'pod', 'photo']),
('wrong_fnsku', 'FNSKU does not match', 'wrong_format', 'identifier', true, 'Verify FNSKU on documents', ARRAY['invoice']),
('vat_required', 'VAT ID required for EU claims', 'missing_evidence', 'vat', true, 'Add VAT ID to proof packet', ARRAY['vat_document'])
ON CONFLICT (pattern_name) DO NOTHING;

-- Seed initial evidence mappings
INSERT INTO evidence_mappings (claim_type, evidence_type, requirement_level, weight, description) VALUES
('lost_inventory', 'invoice', 'mandatory', 1.00, 'Invoice showing purchase of lost items'),
('lost_inventory', 'pod', 'recommended', 0.80, 'Proof of delivery to Amazon'),
('lost_inventory', 'tracking', 'recommended', 0.70, 'Shipment tracking information'),
('damaged_inventory', 'invoice', 'mandatory', 1.00, 'Invoice for damaged items'),
('damaged_inventory', 'photo', 'optional', 0.50, 'Photo of damage if available'),
('overcharge', 'invoice', 'mandatory', 1.00, 'Invoice showing correct amounts'),
('customer_return', 'tracking', 'mandatory', 1.00, 'Return shipment tracking'),
('customer_return', 'invoice', 'recommended', 0.70, 'Original sale invoice')
ON CONFLICT (claim_type, evidence_type) DO NOTHING;

-- Seed initial claim rules
INSERT INTO claim_rules (rule_name, claim_type, rule_type, conditions, actions, priority) VALUES
('lost_inventory_detection', 'lost_inventory', 'detection', 
    '{"inventory_discrepancy_min": 1, "days_since_inbound": 30, "warehouse_confirmed": true}',
    '{"create_claim": true, "priority": "normal", "auto_file": false}', 100),
('lost_inventory_evidence', 'lost_inventory', 'evidence_requirement',
    '{}',
    '{"required": ["invoice"], "recommended": ["pod", "tracking"]}', 90),
('damaged_item_detection', 'damaged_inventory', 'detection',
    '{"damage_reported": true, "quantity_min": 1}',
    '{"create_claim": true, "priority": "high", "auto_file": false}', 100),
('overcharge_detection', 'overcharge', 'detection',
    '{"fee_discrepancy_min": 0.01, "calculate_expected": true}',
    '{"create_claim": true, "priority": "normal", "auto_file": true}', 80)
ON CONFLICT (rule_name) DO NOTHING;

-- ============================================
-- GRANTS
-- ============================================

GRANT SELECT, INSERT, UPDATE, DELETE ON schema_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON schema_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON evidence_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rejection_patterns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_rejections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flag_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flag_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON manual_review_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON analyst_corrections TO authenticated;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE schema_changes IS 'Layer 1: Tracks SP-API schema changes detected by monitoring';
COMMENT ON TABLE schema_snapshots IS 'Layer 1: Stores SP-API schema snapshots for comparison';
COMMENT ON TABLE claim_rules IS 'Layer 2: Hot-updatable claim rules (no code changes needed)';
COMMENT ON TABLE evidence_mappings IS 'Layer 2: Evidence requirements per claim type';
COMMENT ON TABLE rejection_patterns IS 'Layer 5: Categorized rejection patterns from Amazon';
COMMENT ON TABLE claim_rejections IS 'Layer 5: Individual claim rejections for learning';
COMMENT ON TABLE feature_flags IS 'Layer 6: Gradual rollout feature flags';
COMMENT ON TABLE feature_flag_evaluations IS 'Layer 6: History of flag evaluations';
COMMENT ON TABLE feature_flag_metrics IS 'Layer 6: Metrics tracked per feature flag';
COMMENT ON TABLE manual_review_queue IS 'Layer 7: Cases flagged for human review';
COMMENT ON TABLE analyst_corrections IS 'Layer 7: Corrections made by analysts';



-- ========================================
-- Migration: 020_create_tokens_table.sql
-- ========================================

-- Migration: Create tokens table for OAuth token storage
-- This table stores encrypted OAuth tokens with IV+data format for proper encryption handling
-- Migration: 020_create_tokens_table.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tokens table with IV+data columns for encrypted token storage
CREATE TABLE IF NOT EXISTS tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider varchar(64) NOT NULL CHECK (provider IN ('amazon', 'gmail', 'stripe')),
  access_token_iv text NOT NULL,
  access_token_data text NOT NULL,
  refresh_token_iv text,
  refresh_token_data text,
  token_type varchar(32) DEFAULT 'Bearer',
  scope text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  UNIQUE(user_id, provider)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_tokens_user_provider ON tokens(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_tokens_provider ON tokens(provider);
CREATE INDEX IF NOT EXISTS idx_tokens_expires_at ON tokens(expires_at);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Drop trigger if it exists, then create it
DROP TRIGGER IF EXISTS update_tokens_updated_at ON tokens;
CREATE TRIGGER update_tokens_updated_at
  BEFORE UPDATE ON tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_tokens_updated_at();

-- Enable RLS
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only access their own tokens)
DROP POLICY IF EXISTS "Users can view their own tokens" ON tokens;
CREATE POLICY "Users can view their own tokens" ON tokens
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

DROP POLICY IF EXISTS "Users can insert their own tokens" ON tokens;
CREATE POLICY "Users can insert their own tokens" ON tokens
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

DROP POLICY IF EXISTS "Users can update their own tokens" ON tokens;
CREATE POLICY "Users can update their own tokens" ON tokens
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

DROP POLICY IF EXISTS "Users can delete their own tokens" ON tokens;
CREATE POLICY "Users can delete their own tokens" ON tokens
  FOR DELETE USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

-- Add comment
COMMENT ON TABLE tokens IS 'OAuth tokens stored with encrypted IV+data format';





-- ========================================
-- Migration: 021_create_users_table.sql
-- ========================================

-- Migration: Create users table for Zero Agent Layer
-- This table stores user/tenant information for OAuth connections
-- Migration: 021_create_users_table.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) UNIQUE,
  amazon_seller_id varchar(255) UNIQUE NOT NULL,
  seller_id varchar(255), -- Optional, for compatibility
  company_name varchar(255),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_amazon_seller_id ON users(amazon_seller_id);
CREATE INDEX IF NOT EXISTS idx_users_seller_id ON users(seller_id) WHERE seller_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_users_updated_at();

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only access their own data)
DROP POLICY IF EXISTS "Users can view their own data" ON users;
CREATE POLICY "Users can view their own data" ON users
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(id AS TEXT));

DROP POLICY IF EXISTS "Service role can manage users" ON users;
CREATE POLICY "Service role can manage users" ON users
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Add comment
COMMENT ON TABLE users IS 'User/tenant information for OAuth connections';




-- ========================================
-- Migration: 022_add_agent2_data_sync_events.sql
-- ========================================

-- Migration: Add Agent 2 (Data Sync) to agent_events table
-- This allows Agent 2 to log events for continuous learning

-- Update agent_events table to include 'data_sync' as a valid agent type
ALTER TABLE agent_events 
  DROP CONSTRAINT IF EXISTS agent_events_agent_check;

ALTER TABLE agent_events 
  ADD CONSTRAINT agent_events_agent_check 
  CHECK (agent IN (
    'evidence_ingestion',
    'document_parsing',
    'evidence_matching',
    'refund_filing',
    'recoveries',
    'billing',
    'data_sync'  -- Agent 2: Continuous Data Sync
  ));

-- Add comment
COMMENT ON COLUMN agent_events.agent IS 'Agent type: evidence_ingestion, document_parsing, evidence_matching, refund_filing, recoveries, billing, or data_sync';




-- ========================================
-- Migration: 023_add_agent3_claim_detection_events.sql
-- ========================================

-- Migration: Add Agent 3 (Claim Detection) to agent_events table
-- This allows Agent 3 to log events for continuous learning

-- Update agent_events table to include 'claim_detection' as a valid agent type
ALTER TABLE agent_events 
  DROP CONSTRAINT IF EXISTS agent_events_agent_check;

ALTER TABLE agent_events 
  ADD CONSTRAINT agent_events_agent_check 
  CHECK (agent IN (
    'evidence_ingestion',
    'document_parsing',
    'evidence_matching',
    'refund_filing',
    'recoveries',
    'billing',
    'data_sync',        -- Agent 2: Continuous Data Sync
    'claim_detection'  -- Agent 3: Claim Detection
  ));

-- Add comment
COMMENT ON COLUMN agent_events.agent IS 'Agent type: evidence_ingestion, document_parsing, evidence_matching, refund_filing, recoveries, billing, data_sync, or claim_detection';




-- ========================================
-- Migration: 024_add_expected_payout_date_to_disputes.sql
-- ========================================

-- Migration: Ensure dispute_cases has expected payout tracking

ALTER TABLE dispute_cases
ADD COLUMN IF NOT EXISTS expected_payout_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dispute_cases_expected_payout
  ON dispute_cases(expected_payout_date);




-- ========================================
-- Migration: 025_add_stripe_customer_id_to_users.sql
-- ========================================

-- Migration: Add stripe_customer_id reference for Stripe mapping
BEGIN;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS stripe_customer_id INT NULL;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id
ON users (stripe_customer_id);

COMMIT;




-- ========================================
-- Migration: 026_add_link_type_to_evidence_links.sql
-- ========================================

-- Migration: Add missing columns to dispute_evidence_links
-- Required by Agent 6 (Evidence Matching)

-- Add link_type column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_evidence_links' AND column_name = 'link_type'
  ) THEN
    ALTER TABLE dispute_evidence_links
    ADD COLUMN link_type VARCHAR(50) DEFAULT 'auto_matched';
  END IF;
END
$$;

-- Add confidence_score column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_evidence_links' AND column_name = 'confidence_score'
  ) THEN
    ALTER TABLE dispute_evidence_links
    ADD COLUMN confidence_score DECIMAL(5,4);
  END IF;
END
$$;

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_link_type 
ON dispute_evidence_links(link_type);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_confidence 
ON dispute_evidence_links(confidence_score);

-- Comments
COMMENT ON COLUMN dispute_evidence_links.link_type IS 
  'Type of evidence link: auto_matched, manual, smart_prompt, rejected';
COMMENT ON COLUMN dispute_evidence_links.confidence_score IS 
  'Confidence score of the match (0.0000 to 1.0000)';



-- ========================================
-- Migration: 027_add_claim_number.sql
-- ========================================

-- Migration: Add claim_number column for human-readable claim IDs
-- Format: {TYPE}-{YYMM}-{SEQ} e.g., LI-2412-0001

-- Add the claim_number column
ALTER TABLE detection_results
ADD COLUMN IF NOT EXISTS claim_number VARCHAR(20);

-- Create a unique index for claim_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_detection_results_claim_number 
ON detection_results(claim_number) 
WHERE claim_number IS NOT NULL;

-- Create a sequence for claim numbers (per month)
CREATE SEQUENCE IF NOT EXISTS claim_number_seq START 1;

-- Function to generate human-readable claim number
CREATE OR REPLACE FUNCTION generate_claim_number(anomaly_type TEXT)
RETURNS TEXT AS $$
DECLARE
    type_prefix TEXT;
    year_month TEXT;
    seq_num INTEGER;
    claim_num TEXT;
BEGIN
    -- Map anomaly type to prefix
    CASE 
        WHEN anomaly_type ILIKE '%lost%' OR anomaly_type = 'missing_unit' THEN type_prefix := 'LI';
        WHEN anomaly_type ILIKE '%damaged%' OR anomaly_type = 'damaged_stock' THEN type_prefix := 'DM';
        WHEN anomaly_type ILIKE '%fee%' OR anomaly_type = 'incorrect_fee' THEN type_prefix := 'FD';
        WHEN anomaly_type ILIKE '%return%' OR anomaly_type = 'return_not_credited' THEN type_prefix := 'UR';
        WHEN anomaly_type ILIKE '%overcharge%' OR anomaly_type = 'duplicate_charge' THEN type_prefix := 'OC';
        ELSE type_prefix := 'CL';
    END CASE;
    
    -- Get current year-month
    year_month := TO_CHAR(NOW(), 'YYMM');
    
    -- Get next sequence number
    seq_num := nextval('claim_number_seq');
    
    -- Format claim number
    claim_num := type_prefix || '-' || year_month || '-' || LPAD(seq_num::TEXT, 4, '0');
    
    RETURN claim_num;
END;
$function$ LANGUAGE plpgsql;

-- Trigger to auto-generate claim_number on insert
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
    IF NEW.claim_number IS NULL THEN
        NEW.claim_number := generate_claim_number(COALESCE(NEW.anomaly_type, 'unknown'));
    END IF;
    RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trg_generate_claim_number ON detection_results;
CREATE TRIGGER trg_generate_claim_number
BEFORE INSERT ON detection_results
FOR EACH ROW
EXECUTE FUNCTION trigger_generate_claim_number();

-- Backfill existing records with claim numbers
DO $$
DECLARE
    rec RECORD;
    new_claim_num TEXT;
BEGIN
    FOR rec IN 
        SELECT id, anomaly_type 
        FROM detection_results 
        WHERE claim_number IS NULL
        ORDER BY created_at ASC
    LOOP
        new_claim_num := generate_claim_number(COALESCE(rec.anomaly_type, 'unknown'));
        UPDATE detection_results SET claim_number = new_claim_num WHERE id = rec.id;
    END LOOP;
END $$;

-- Add comment
COMMENT ON COLUMN detection_results.claim_number IS 'Human-readable claim ID in format TYPE-YYMM-NNNN';



-- ========================================
-- Migration: 028_drop_anomaly_type_constraint.sql
-- ========================================

-- Migration: Drop restrictive anomaly_type check constraint
-- Purpose: Allow all 64+ Amazon FBA claim types instead of just 5
-- The detection system uses types like: fulfillment_fee_error, weight_fee_overcharge, 
-- lost_warehouse, damaged_warehouse, carrier_claim, refund_no_return, storage_overcharge, etc.

-- Drop the old restrictive constraint
ALTER TABLE detection_results DROP CONSTRAINT IF EXISTS detection_results_anomaly_type_check;

-- Add a comment explaining why we don't use a CHECK constraint here
COMMENT ON COLUMN detection_results.anomaly_type IS 'Type of detected anomaly - accepts any text value to support 64+ Amazon FBA claim types';



-- ========================================
-- Migration: 029_fix_claim_number_constraint.sql
-- ========================================

-- Migration: Fix claim_number constraint to allow batch inserts
-- Problem: Unique constraint on claim_number causes failures during batch inserts
-- Solution: Drop the unique index and rely on the ID for uniqueness

-- Drop the unique index on claim_number
DROP INDEX IF EXISTS idx_detection_results_claim_number;

-- Create a non-unique index instead for query performance
CREATE INDEX IF NOT EXISTS idx_detection_results_claim_number_nonunique 
ON detection_results(claim_number);

-- Update the generate function to include a random suffix for uniqueness
CREATE OR REPLACE FUNCTION generate_claim_number(anomaly_type TEXT)
RETURNS TEXT AS $$
DECLARE
    type_prefix TEXT;
    year_month TEXT;
    seq_num INTEGER;
    random_suffix TEXT;
    claim_num TEXT;
BEGIN
    -- Map anomaly type to prefix
    CASE 
        WHEN anomaly_type ILIKE '%lost%' OR anomaly_type ILIKE '%missing%' THEN type_prefix := 'LI';
        WHEN anomaly_type ILIKE '%damaged%' THEN type_prefix := 'DM';
        WHEN anomaly_type ILIKE '%fee%' OR anomaly_type ILIKE '%overcharge%' THEN type_prefix := 'FD';
        WHEN anomaly_type ILIKE '%return%' OR anomaly_type ILIKE '%refund%' THEN type_prefix := 'UR';
        WHEN anomaly_type ILIKE '%storage%' THEN type_prefix := 'ST';
        WHEN anomaly_type ILIKE '%carrier%' THEN type_prefix := 'CC';
        ELSE type_prefix := 'CL';
    END CASE;
    
    -- Get current year-month
    year_month := TO_CHAR(NOW(), 'YYMM');
    
    -- Get next sequence number
    seq_num := nextval('claim_number_seq');
    
    -- Add random suffix to ensure uniqueness
    random_suffix := SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 4);
    
    -- Format claim number with random suffix
    claim_num := type_prefix || '-' || year_month || '-' || seq_num::TEXT || '-' || random_suffix;
    
    RETURN claim_num;
END;
$function$ LANGUAGE plpgsql;

COMMENT ON COLUMN detection_results.claim_number IS 'Human-readable claim ID - format TYPE-YYMM-SEQ-RAND';



-- ========================================
-- Migration: 030_add_claims_columns.sql
-- ========================================

-- Migration: Add missing columns to claims table for detection-to-claims flow
-- The current Supabase claims table is missing columns expected by the code

-- First, check if columns exist and add if missing
DO $$
BEGIN
    -- Add user_id if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'user_id') THEN
        ALTER TABLE claims ADD COLUMN user_id UUID;
        CREATE INDEX IF NOT EXISTS idx_claims_user_id ON claims(user_id);
    END IF;
    
    -- Add claim_type if not exists (with default)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'claim_type') THEN
        ALTER TABLE claims ADD COLUMN claim_type TEXT DEFAULT 'reimbursement';
    END IF;
    
    -- Add provider if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'provider') THEN
        ALTER TABLE claims ADD COLUMN provider TEXT DEFAULT 'amazon';
    END IF;
    
    -- Add reference_id if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'reference_id') THEN
        ALTER TABLE claims ADD COLUMN reference_id TEXT;
    END IF;
    
    -- Add amount if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'amount') THEN
        ALTER TABLE claims ADD COLUMN amount NUMERIC(12,2) DEFAULT 0;
    END IF;
    
    -- Add currency if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'currency') THEN
        ALTER TABLE claims ADD COLUMN currency TEXT DEFAULT 'USD';
    END IF;
    
    -- Add status if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'status') THEN
        ALTER TABLE claims ADD COLUMN status TEXT DEFAULT 'pending';
    END IF;
    
    -- Add reason if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'reason') THEN
        ALTER TABLE claims ADD COLUMN reason TEXT;
    END IF;
    
    -- Add evidence if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'evidence') THEN
        ALTER TABLE claims ADD COLUMN evidence TEXT[];
    END IF;
    
    -- Add submitted_at if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'submitted_at') THEN
        ALTER TABLE claims ADD COLUMN submitted_at TIMESTAMPTZ;
    END IF;
    
    -- Add created_at if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'created_at') THEN
        ALTER TABLE claims ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    
    -- Add updated_at if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'updated_at') THEN
        ALTER TABLE claims ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

COMMENT ON TABLE claims IS 'Claims created from detection results for frontend visibility';



-- ========================================
-- Migration: 031_drop_dispute_case_type_constraint.sql
-- ========================================

-- Migration: Drop restrictive case_type check constraint on dispute_cases
-- Purpose: Allow all 64+ Amazon FBA claim types instead of limited enum values
-- This is the same issue we fixed for detection_results (anomaly_type) and claims (claim_type)

-- Drop the old restrictive constraint
ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_case_type_check;

-- Change to text type to allow any value
ALTER TABLE dispute_cases ALTER COLUMN case_type TYPE TEXT;

-- Add comment
COMMENT ON COLUMN dispute_cases.case_type IS 'Type of dispute case - accepts any text value to support 64+ Amazon FBA claim types';



-- ========================================
-- Migration: 032_add_timeline_columns.sql
-- ========================================

-- Migration: Add timeline column to detection_results and claims tables
-- Purpose: Store actual event history for claims (filed, status changes, escalations, etc.)

-- Add timeline JSONB column to detection_results
ALTER TABLE detection_results 
ADD COLUMN IF NOT EXISTS timeline JSONB DEFAULT '[]'::jsonb;

-- Add timeline JSONB column to claims
ALTER TABLE claims 
ADD COLUMN IF NOT EXISTS timeline JSONB DEFAULT '[]'::jsonb;

-- Add index for timeline queries (GIN index for JSONB)
CREATE INDEX IF NOT EXISTS idx_detection_results_timeline 
ON detection_results USING GIN (timeline);

CREATE INDEX IF NOT EXISTS idx_claims_timeline 
ON claims USING GIN (timeline);

-- Comments
COMMENT ON COLUMN detection_results.timeline IS 'Array of timeline events: [{id, date, action, description, amount?, rejectionReason?, escalationRound?}]';
COMMENT ON COLUMN claims.timeline IS 'Array of timeline events: [{id, date, action, description, amount?, rejectionReason?, escalationRound?}]';



-- ========================================
-- Migration: 033_detection_outcomes.sql
-- ========================================

-- Migration: 033_detection_outcomes
-- Phase 3: ML & Pattern Recognition - Outcome Tracking

-- Table to track claim outcomes (approved/rejected/partial)
-- This enables the confidence calibration feedback loop

CREATE TABLE IF NOT EXISTS detection_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_result_id UUID REFERENCES detection_results(id) ON DELETE CASCADE,
  
  -- Original detection info (denormalized for fast queries)
  seller_id UUID NOT NULL,
  anomaly_type TEXT NOT NULL,
  predicted_confidence NUMERIC(4,2) NOT NULL,  -- What we predicted (0.00-1.00)
  estimated_value NUMERIC(12,2) NOT NULL,
  
  -- Actual outcome
  actual_outcome TEXT NOT NULL CHECK (actual_outcome IN ('approved', 'rejected', 'partial', 'pending', 'expired')),
  recovery_amount NUMERIC(12,2) DEFAULT 0,      -- What was actually recovered
  recovery_percentage NUMERIC(5,2),             -- recovery_amount / estimated_value
  
  -- Amazon response
  amazon_case_id TEXT,
  amazon_response_date TIMESTAMPTZ,
  amazon_response_reason TEXT,
  
  -- Timing
  claim_filed_date TIMESTAMPTZ,
  resolution_date TIMESTAMPTZ,
  days_to_resolution INTEGER,
  
  -- Metadata
  filed_by TEXT,  -- 'auto', 'manual', 'agent'
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast ML queries
CREATE INDEX IF NOT EXISTS idx_outcomes_seller ON detection_outcomes(seller_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_anomaly ON detection_outcomes(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON detection_outcomes(actual_outcome);
CREATE INDEX IF NOT EXISTS idx_outcomes_date ON detection_outcomes(created_at);

-- Composite index for accuracy calculations per type
CREATE INDEX IF NOT EXISTS idx_outcomes_type_outcome ON detection_outcomes(anomaly_type, actual_outcome);

-- View for confidence accuracy by anomaly type
CREATE OR REPLACE VIEW anomaly_type_accuracy AS
SELECT 
  anomaly_type,
  COUNT(*) as total_claims,
  COUNT(*) FILTER (WHERE actual_outcome = 'approved') as approved_count,
  COUNT(*) FILTER (WHERE actual_outcome = 'rejected') as rejected_count,
  COUNT(*) FILTER (WHERE actual_outcome = 'partial') as partial_count,
  COUNT(*) FILTER (WHERE actual_outcome = 'pending') as pending_count,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome IN ('approved', 'partial'))::NUMERIC / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome != 'pending'), 0) * 100, 
    2
  ) as approval_rate,
  ROUND(AVG(predicted_confidence) * 100, 2) as avg_predicted_confidence,
  ROUND(AVG(recovery_percentage), 2) as avg_recovery_percentage,
  ROUND(AVG(days_to_resolution), 1) as avg_days_to_resolution,
  SUM(recovery_amount) as total_recovered
FROM detection_outcomes
GROUP BY anomaly_type
ORDER BY total_claims DESC;

-- View for seller-level patterns
CREATE OR REPLACE VIEW seller_detection_patterns AS
SELECT 
  seller_id,
  COUNT(*) as total_detections,
  COUNT(DISTINCT anomaly_type) as unique_anomaly_types,
  ROUND(
    COUNT(*) FILTER (WHERE actual_outcome IN ('approved', 'partial'))::NUMERIC / 
    NULLIF(COUNT(*) FILTER (WHERE actual_outcome != 'pending'), 0) * 100, 
    2
  ) as overall_approval_rate,
  SUM(recovery_amount) as total_recovered,
  SUM(estimated_value) as total_estimated,
  ROUND(SUM(recovery_amount) / NULLIF(SUM(estimated_value), 0) * 100, 2) as recovery_efficiency,
  MODE() WITHIN GROUP (ORDER BY anomaly_type) as most_common_anomaly
FROM detection_outcomes
GROUP BY seller_id;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
  NEW.updated_at = NOW();
  -- Calculate days to resolution if both dates exist
  IF NEW.claim_filed_date IS NOT NULL AND NEW.resolution_date IS NOT NULL THEN
    NEW.days_to_resolution = EXTRACT(DAY FROM NEW.resolution_date - NEW.claim_filed_date);
  END IF;
  -- Calculate recovery percentage
  IF NEW.estimated_value > 0 THEN
    NEW.recovery_percentage = (NEW.recovery_amount / NEW.estimated_value) * 100;
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_detection_outcomes_updated
  BEFORE UPDATE ON detection_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION update_detection_outcomes_timestamp();

-- Insert some seed data for testing (mock outcomes)
-- This gives the ML system something to learn from initially

INSERT INTO detection_outcomes (seller_id, anomaly_type, predicted_confidence, estimated_value, actual_outcome, recovery_amount, claim_filed_date, resolution_date)
SELECT 
  gen_random_uuid() as seller_id,
  anomaly_type,
  (0.7 + random() * 0.25)::numeric(4,2) as predicted_confidence,
  (50 + random() * 450)::numeric(12,2) as estimated_value,
  (ARRAY['approved', 'approved', 'approved', 'rejected', 'partial'])[floor(random() * 5 + 1)] as actual_outcome,
  CASE 
    WHEN random() > 0.3 THEN (30 + random() * 400)::numeric(12,2)
    ELSE 0
  END as recovery_amount,
  NOW() - INTERVAL '1 day' * (floor(random() * 90 + 1)),
  NOW() - INTERVAL '1 day' * (floor(random() * 30))
FROM (
  SELECT unnest(ARRAY[
    'lost_warehouse', 'damaged_warehouse', 'refund_no_return',
    'fulfillment_fee_error', 'storage_overcharge', 'commission_overcharge',
    'chargeback', 'atoz_claim', 'shipment_shortage', 'removal_unfulfilled',
    'switcheroo', 'carrier_damage'
  ]) as anomaly_type
) types
CROSS JOIN generate_series(1, 30);  -- 30 samples per type = 360 total



-- ========================================
-- Migration: 034_realtime_alerts.sql
-- ========================================

-- Migration: 034_realtime_alerts
-- Phase 4: Real-time Streaming - Alert Storage

-- Table to store real-time alerts
CREATE TABLE IF NOT EXISTS realtime_alerts (
  id TEXT PRIMARY KEY,
  seller_id UUID NOT NULL,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  estimated_value NUMERIC(12,2) NOT NULL,
  message TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Source event info
  source_table TEXT,
  source_event_type TEXT,
  source_row_id TEXT,
  
  -- Delivery tracking
  delivered BOOLEAN DEFAULT FALSE,
  delivered_at TIMESTAMPTZ,
  delivery_channel TEXT,  -- 'websocket', 'email', 'sms', 'webhook'
  
  -- Action tracking
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  action_taken TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_alerts_seller ON realtime_alerts(seller_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON realtime_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_delivered ON realtime_alerts(delivered);
CREATE INDEX IF NOT EXISTS idx_alerts_detected ON realtime_alerts(detected_at DESC);

-- View for unacknowledged urgent alerts
CREATE OR REPLACE VIEW urgent_alerts AS
SELECT *
FROM realtime_alerts
WHERE severity IN ('high', 'critical')
  AND acknowledged = FALSE
  AND detected_at >= NOW() - INTERVAL '7 days'
ORDER BY 
  CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 END,
  detected_at DESC;

-- View for alert summary by seller
CREATE OR REPLACE VIEW seller_alert_summary AS
SELECT 
  seller_id,
  COUNT(*) as total_alerts,
  COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
  COUNT(*) FILTER (WHERE severity = 'high') as high_count,
  COUNT(*) FILTER (WHERE acknowledged = FALSE) as unacknowledged,
  SUM(estimated_value) as total_value_at_risk,
  MAX(detected_at) as last_alert_time
FROM realtime_alerts
WHERE detected_at >= NOW() - INTERVAL '30 days'
GROUP BY seller_id;

-- Function to update timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_alerts_updated
  BEFORE UPDATE ON realtime_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_alerts_timestamp();

-- Enable Realtime for this table (so we can push alerts to frontend)
ALTER PUBLICATION supabase_realtime ADD TABLE realtime_alerts;



-- ========================================
-- Migration: 035_referral_invites.sql
-- ========================================

-- Migration: Create referral_invites table
-- Purpose: Store seller referral invitations

CREATE TABLE IF NOT EXISTS referral_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id TEXT NOT NULL,  -- User who sent the invite
    invitee_email TEXT NOT NULL,  -- Email of the person being invited
    referral_link TEXT NOT NULL,  -- The referral signup link
    message TEXT,  -- Custom message from referrer
    status TEXT NOT NULL DEFAULT 'sent',  -- sent, opened, clicked, signed_up, resent
    email_sent_at TIMESTAMPTZ,  -- When the email was actually delivered
    opened_at TIMESTAMPTZ,  -- When they opened the email (if tracked)
    clicked_at TIMESTAMPTZ,  -- When they clicked the link
    signed_up_at TIMESTAMPTZ,  -- When they completed signup
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_referral_invites_referrer_id ON referral_invites(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_invites_invitee_email ON referral_invites(invitee_email);
CREATE INDEX IF NOT EXISTS idx_referral_invites_status ON referral_invites(status);
CREATE INDEX IF NOT EXISTS idx_referral_invites_created_at ON referral_invites(created_at);

-- Comments
COMMENT ON TABLE referral_invites IS 'Stores seller referral invitations for the referral program';
COMMENT ON COLUMN referral_invites.referrer_id IS 'User ID of the seller who sent the invitation';
COMMENT ON COLUMN referral_invites.status IS 'Invitation status: sent, opened, clicked, signed_up, resent';



-- ========================================
-- Migration: 036_sync_snapshots_and_coverage.sql
-- ========================================

-- Migration 036: Sync Snapshots and Coverage Tracking
-- Purpose: Enable dataset versioning and sync coverage tracking for Pillars 2 & 3

-- Add sync fingerprint for idempotent job detection
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS sync_fingerprint TEXT;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS last_successful_sync_at TIMESTAMPTZ;

-- Create index for fingerprint lookups
CREATE INDEX IF NOT EXISTS idx_sync_progress_fingerprint ON sync_progress(user_id, sync_fingerprint);

-- Create sync_snapshots table for dataset versioning
CREATE TABLE IF NOT EXISTS sync_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_id TEXT,  -- References sync_progress.sync_id (TEXT type)
  user_id UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  coverage JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one snapshot per user per date
  CONSTRAINT unique_user_date_snapshot UNIQUE (user_id, snapshot_date)
);

-- Index for fast snapshot lookups
CREATE INDEX IF NOT EXISTS idx_sync_snapshots_user_date ON sync_snapshots(user_id, snapshot_date DESC);

-- Add record_hash column to key tables for deduplication (only if tables exist)
DO $$ 
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'orders') THEN
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'shipments') THEN
    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'returns') THEN
    ALTER TABLE returns ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'settlements') THEN
    ALTER TABLE settlements ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'inventory') THEN
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS record_hash TEXT;
  END IF;
END $$;

-- Add structured error tracking to sync_progress
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS error_details JSONB;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Add coverage tracking to sync_progress
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS coverage JSONB;
ALTER TABLE sync_progress ADD COLUMN IF NOT EXISTS coverage_complete BOOLEAN DEFAULT FALSE;

-- Comment on new columns
COMMENT ON COLUMN sync_progress.sync_fingerprint IS 'Hash for idempotent job detection';
COMMENT ON COLUMN sync_progress.last_successful_sync_at IS 'Timestamp of last successful sync completion';
COMMENT ON COLUMN sync_progress.error_code IS 'Structured error code: RATE_LIMITED, AUTH_EXPIRED, etc.';
COMMENT ON COLUMN sync_progress.coverage IS 'Entity coverage tracking JSONB';

COMMENT ON TABLE sync_snapshots IS 'Daily snapshots of sync metrics for versioning and comparison';




-- ========================================
-- Migration: 037_evidence_match_results.sql
-- ========================================

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



-- ========================================
-- Migration: 038_fix_provider_constraints.sql
-- ========================================

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



-- ========================================
-- Migration: 039_seller_proxy_assignments.sql
-- ========================================

-- Migration: Seller Proxy Assignments
-- IP CONTAMINATION PREVENTION
-- 
-- This table maps sellers to their dedicated proxy sessions.
-- Each seller MUST have a unique, consistent IP address when communicating with Amazon.
-- Using the same IP for multiple sellers causes "chain bans" if one account is suspended.

CREATE TABLE IF NOT EXISTS seller_proxy_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL UNIQUE,
  
  -- Proxy session identifier (used with residential proxy providers)
  -- Format: "opside_seller_{seller_id_hash}" for sticky sessions
  proxy_session_id TEXT NOT NULL,
  
  -- Proxy provider configuration
  proxy_provider TEXT NOT NULL DEFAULT 'brightdata', -- brightdata, oxylabs, smartproxy, etc.
  proxy_region TEXT DEFAULT 'us', -- Geographic region for IP assignment
  
  -- Last known IP for this seller (for audit/debugging)
  last_known_ip TEXT,
  last_ip_check TIMESTAMP WITH TIME ZONE,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'rotated')),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups by seller_id
CREATE INDEX IF NOT EXISTS idx_seller_proxy_seller_id ON seller_proxy_assignments(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_proxy_status ON seller_proxy_assignments(status);

-- Enable RLS
ALTER TABLE seller_proxy_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Service role can manage all assignments
DROP POLICY IF EXISTS "Service can manage proxy assignments" ON seller_proxy_assignments;
CREATE POLICY "Service can manage proxy assignments" ON seller_proxy_assignments
  FOR ALL USING (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_seller_proxy_assignments_updated_at ON seller_proxy_assignments;
CREATE TRIGGER update_seller_proxy_assignments_updated_at 
  BEFORE UPDATE ON seller_proxy_assignments 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE seller_proxy_assignments IS 'Maps sellers to dedicated proxy sessions to prevent IP contamination and chain bans';
COMMENT ON COLUMN seller_proxy_assignments.proxy_session_id IS 'Sticky session ID for residential proxy - ensures consistent IP per seller';
COMMENT ON COLUMN seller_proxy_assignments.last_known_ip IS 'Last IP address used for this seller (for audit purposes)';



-- ========================================
-- Migration: 040_mcde_integration.sql
-- ========================================

-- Migration: 040_mcde_integration.sql
-- MCDE (Manufacturing Cost Document Engine) Integration
-- Adds columns for OCR extraction and cost component storage

-- Add MCDE columns to evidence_documents
ALTER TABLE evidence_documents 
  ADD COLUMN IF NOT EXISTS mcde_extraction JSONB,
  ADD COLUMN IF NOT EXISTS mcde_cost_components JSONB,
  ADD COLUMN IF NOT EXISTS mcde_confidence DECIMAL(4,3),
  ADD COLUMN IF NOT EXISTS ocr_language TEXT DEFAULT 'eng',
  ADD COLUMN IF NOT EXISTS unit_manufacturing_cost DECIMAL(12,4);

-- Add index for MCDE extraction queries
CREATE INDEX IF NOT EXISTS idx_evidence_documents_mcde_extraction 
  ON evidence_documents USING GIN (mcde_extraction);

-- Add index for cost components queries
CREATE INDEX IF NOT EXISTS idx_evidence_documents_mcde_cost_components 
  ON evidence_documents USING GIN (mcde_cost_components);

-- Add comment for documentation
COMMENT ON COLUMN evidence_documents.mcde_extraction IS 'Full OCR extraction result from MCDE including text and metadata';
COMMENT ON COLUMN evidence_documents.mcde_cost_components IS 'Extracted cost components: material, labor, overhead, shipping, tax';
COMMENT ON COLUMN evidence_documents.mcde_confidence IS 'OCR extraction confidence score (0.0-1.0)';
COMMENT ON COLUMN evidence_documents.ocr_language IS 'OCR language used (e.g., eng, chi_sim, eng+chi_sim)';
COMMENT ON COLUMN evidence_documents.unit_manufacturing_cost IS 'Extracted unit manufacturing cost from invoice';

-- Grant permissions
GRANT SELECT, UPDATE ON evidence_documents TO authenticated;
GRANT SELECT, UPDATE ON evidence_documents TO service_role;



-- ========================================
-- Migration: 041_user_notes.sql
-- ========================================

-- Create user_notes table for persistent note-taking
CREATE TABLE IF NOT EXISTS public.user_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL, -- Using TEXT to support both UUIDs and demo-user IDs
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- index for user_id to speed up lookups
CREATE INDEX IF NOT EXISTS idx_user_notes_user_id ON public.user_notes(user_id);

-- Enable Row Level Security
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

-- Allow users to see only their own notes
CREATE POLICY "Users can view their own notes" 
    ON public.user_notes FOR SELECT 
    USING (user_id = auth.uid()::text OR user_id = 'demo-user');

-- Allow users to insert their own notes
CREATE POLICY "Users can insert their own notes" 
    ON public.user_notes FOR INSERT 
    WITH CHECK (user_id = auth.uid()::text OR user_id = 'demo-user');

-- Allow users to delete their own notes
CREATE POLICY "Users can delete their own notes" 
    ON public.user_notes FOR DELETE 
    USING (user_id = auth.uid()::text OR user_id = 'demo-user');

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_notes_updated_at
    BEFORE UPDATE ON public.user_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();



-- ========================================
-- Migration: 042_create_tenants_table.sql
-- ========================================

-- ========================================
-- Migration: 042_create_tenants_table.sql
-- Multi-Tenant SaaS: Core Tenant Model
-- ========================================

-- Ensure the updated_at trigger function exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Tenants table with full lifecycle states
CREATE TABLE IF NOT EXISTS tenants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,  -- URL-friendly: /app/:slug/dashboard
  
  -- Lifecycle State
  status TEXT DEFAULT 'active' CHECK (status IN (
    'active',           -- Normal operation
    'trialing',         -- Free trial period
    'suspended',        -- Payment failure - deny new actions
    'read_only',        -- Past due - can view, cannot create
    'canceled',         -- User canceled - archive data
    'deleted'           -- Marked for purge
  )),
  
  -- Billing
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'professional', 'enterprise')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  
  -- Trial
  trial_ends_at TIMESTAMPTZ,
  
  -- Soft Delete & Data Retention
  deleted_at TIMESTAMPTZ,
  data_purge_scheduled_at TIMESTAMPTZ,
  
  -- Metadata
  settings JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tenant memberships (user-to-tenant mapping)
CREATE TABLE IF NOT EXISTS tenant_memberships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,  -- references auth.users or users table
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by UUID,
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Soft delete
  deleted_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- Tenant invitations (pending invites)
CREATE TABLE IF NOT EXISTS tenant_invitations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by UUID NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for tenants
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan);
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer ON tenants(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_tenants_deleted ON tenants(deleted_at) WHERE deleted_at IS NOT NULL;

-- Indexes for tenant_memberships
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_active ON tenant_memberships(user_id, is_active) WHERE is_active = TRUE AND deleted_at IS NULL;

-- Indexes for tenant_invitations
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_tenant ON tenant_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email ON tenant_invitations(email);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_token ON tenant_invitations(token);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_pending ON tenant_invitations(expires_at) WHERE accepted_at IS NULL;

-- Enable RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenants
DROP POLICY IF EXISTS "Users can view tenants they belong to" ON tenants;
CREATE POLICY "Users can view tenants they belong to" ON tenants
  FOR SELECT USING (
    id IN (
      SELECT tm.tenant_id FROM tenant_memberships tm 
      WHERE tm.user_id = auth.uid() AND tm.is_active = TRUE AND tm.deleted_at IS NULL
    )
  );

-- RLS Policies for tenant_memberships
DROP POLICY IF EXISTS "Users can view memberships of their tenants" ON tenant_memberships;
CREATE POLICY "Users can view memberships of their tenants" ON tenant_memberships
  FOR SELECT USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM tenant_memberships tm 
      WHERE tm.user_id = auth.uid() AND tm.is_active = TRUE AND tm.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Admins can manage memberships" ON tenant_memberships;
CREATE POLICY "Admins can manage memberships" ON tenant_memberships
  FOR ALL USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM tenant_memberships tm 
      WHERE tm.user_id = auth.uid() 
      AND tm.role IN ('owner', 'admin') 
      AND tm.is_active = TRUE 
      AND tm.deleted_at IS NULL
    )
  );

-- RLS Policies for tenant_invitations
DROP POLICY IF EXISTS "Admins can view invitations" ON tenant_invitations;
CREATE POLICY "Admins can view invitations" ON tenant_invitations
  FOR SELECT USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM tenant_memberships tm 
      WHERE tm.user_id = auth.uid() 
      AND tm.role IN ('owner', 'admin') 
      AND tm.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "Admins can create invitations" ON tenant_invitations;
CREATE POLICY "Admins can create invitations" ON tenant_invitations
  FOR INSERT WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM tenant_memberships tm 
      WHERE tm.user_id = auth.uid() 
      AND tm.role IN ('owner', 'admin') 
      AND tm.is_active = TRUE
    )
  );

-- Trigger for updated_at (drop first for idempotency)
DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
CREATE TRIGGER update_tenants_updated_at 
  BEFORE UPDATE ON tenants 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tenant_memberships_updated_at ON tenant_memberships;
CREATE TRIGGER update_tenant_memberships_updated_at 
  BEFORE UPDATE ON tenant_memberships 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Documentation
COMMENT ON TABLE tenants IS 'Multi-tenant SaaS: Organizations/workspaces that own data';
COMMENT ON TABLE tenant_memberships IS 'User-to-tenant mapping with roles';
COMMENT ON TABLE tenant_invitations IS 'Pending invitations to join a tenant';
COMMENT ON COLUMN tenants.status IS 'Lifecycle state: active, trialing, suspended, read_only, canceled, deleted';
COMMENT ON COLUMN tenants.slug IS 'URL-friendly identifier for /app/:slug/* routing';
COMMENT ON COLUMN tenant_memberships.role IS 'User role: owner (billing), admin (manage), member (use), viewer (read-only)';



-- ========================================
-- Migration: 043_create_audit_logs.sql
-- ========================================

-- ========================================
-- Migration: 043_create_audit_logs.sql
-- Multi-Tenant SaaS: Comprehensive Audit Logging
-- ========================================

-- Audit logs table for financial platform compliance
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_user_id UUID,  -- NULL for system actions
  actor_type TEXT CHECK (actor_type IN ('user', 'system', 'worker', 'webhook')),
  
  -- Action Details
  action TEXT NOT NULL,  -- 'dispute.created', 'recovery.approved', 'billing.charged'
  resource_type TEXT NOT NULL,  -- 'dispute', 'recovery', 'user', 'tenant'
  resource_id TEXT,
  
  -- Change Tracking
  payload_before JSONB,
  payload_after JSONB,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  request_id TEXT,  -- Correlation ID for tracing
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- Composite index for common audit queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action_created 
  ON audit_logs(tenant_id, action, created_at DESC);

-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view audit logs for their tenants
DROP POLICY IF EXISTS "Users can view tenant audit logs" ON audit_logs;
CREATE POLICY "Users can view tenant audit logs" ON audit_logs
  FOR SELECT USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM tenant_memberships tm 
      WHERE tm.user_id = auth.uid() 
      AND tm.is_active = TRUE 
      AND tm.deleted_at IS NULL
    )
  );

-- Note: INSERT is only done via supabaseAdmin (service role), no RLS insert policy needed

-- Documentation
COMMENT ON TABLE audit_logs IS 'Comprehensive audit trail for compliance and debugging';
COMMENT ON COLUMN audit_logs.actor_type IS 'Who performed the action: user, system, worker, webhook';
COMMENT ON COLUMN audit_logs.action IS 'Dot-notation action: resource.verb (e.g., dispute.created)';
COMMENT ON COLUMN audit_logs.payload_before IS 'State before change (for updates/deletes)';
COMMENT ON COLUMN audit_logs.payload_after IS 'State after change (for creates/updates)';
COMMENT ON COLUMN audit_logs.request_id IS 'Correlation ID for distributed tracing';



-- ========================================
-- Migration: 044_add_tenant_id_columns.sql
-- ========================================

-- ========================================
-- Migration: 044_add_tenant_id_columns.sql
-- Multi-Tenant SaaS: Add tenant_id to ALL tables (nullable for safe migration)
-- SAFE VERSION: Uses IF EXISTS checks for all tables
-- ========================================

-- This migration adds tenant_id as NULLABLE first
-- Constraints will be added in migration 048 after backfill

DO $$
BEGIN
  -- Core Data Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'returns') THEN
    ALTER TABLE returns ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    ALTER TABLE settlements ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Financial Events & Detection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_events') THEN
    ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_results') THEN
    ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_queue') THEN
    ALTER TABLE detection_queue ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_thresholds') THEN
    ALTER TABLE detection_thresholds ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_whitelist') THEN
    ALTER TABLE detection_whitelist ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Dispute System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_cases') THEN
    ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_automation_rules') THEN
    ALTER TABLE dispute_automation_rules ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence') THEN
    ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_audit_log') THEN
    ALTER TABLE dispute_audit_log ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Evidence System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_sources') THEN
    ALTER TABLE evidence_sources ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_documents') THEN
    ALTER TABLE evidence_documents ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_line_items') THEN
    ALTER TABLE evidence_line_items ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence_links') THEN
    ALTER TABLE dispute_evidence_links ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proof_packets') THEN
    ALTER TABLE proof_packets ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'smart_prompts') THEN
    ALTER TABLE smart_prompts ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_match_results') THEN
    ALTER TABLE evidence_match_results ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Worker Job Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'parser_jobs') THEN
    ALTER TABLE parser_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ingestion_jobs') THEN
    ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'filing_jobs') THEN
    ALTER TABLE filing_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_jobs') THEN
    ALTER TABLE billing_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Recoveries
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recoveries') THEN
    ALTER TABLE recoveries ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- System Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events') THEN
    ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_insights') THEN
    ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'threshold_optimizations') THEN
    ALTER TABLE threshold_optimizations ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Sync Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_detection_triggers') THEN
    ALTER TABLE sync_detection_triggers ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_snapshots') THEN
    ALTER TABLE sync_snapshots ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'realtime_alerts') THEN
    ALTER TABLE realtime_alerts ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Access/User Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens') THEN
    ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_tenant_id UUID;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'referral_invites') THEN
    ALTER TABLE referral_invites ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_proxy_assignments') THEN
    ALTER TABLE seller_proxy_assignments ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notes') THEN
    ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Error logging tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_ingestion_errors') THEN
    ALTER TABLE evidence_ingestion_errors ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_errors') THEN
    ALTER TABLE billing_errors ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  
  -- Dispute submissions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_submissions') THEN
    ALTER TABLE dispute_submissions ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  RAISE NOTICE 'Migration 044 completed - tenant_id columns added to all existing tables';
END $$;



-- ========================================
-- Migration: 045_add_soft_delete_columns.sql
-- ========================================

-- ========================================
-- Migration: 045_add_soft_delete_columns.sql
-- Multi-Tenant SaaS: Soft Delete for Data Retention
-- ========================================

-- Add deleted_at to critical tables for compliance

-- Core entities
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Business data (90-day soft delete period)
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE evidence_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE recoveries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Supporting data
ALTER TABLE evidence_sources ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Indexes for soft delete queries (filter out deleted records efficiently)
CREATE INDEX IF NOT EXISTS idx_tenants_not_deleted ON tenants(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_not_deleted ON tenant_memberships(tenant_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_not_deleted ON users(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dispute_cases_not_deleted ON dispute_cases(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_detection_results_not_deleted ON detection_results(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_evidence_documents_not_deleted ON evidence_documents(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recoveries_not_deleted ON recoveries(tenant_id) WHERE deleted_at IS NULL;

-- Create views that exclude soft-deleted records (for convenience)
CREATE OR REPLACE VIEW active_tenants AS
SELECT * FROM tenants WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_tenant_memberships AS
SELECT * FROM tenant_memberships WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE OR REPLACE VIEW active_users AS
SELECT * FROM users WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_dispute_cases AS
SELECT * FROM dispute_cases WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_recoveries AS
SELECT * FROM recoveries WHERE deleted_at IS NULL;

-- Documentation
COMMENT ON COLUMN tenants.deleted_at IS 'Soft delete timestamp - 30 day retention, 90 day purge';
COMMENT ON COLUMN dispute_cases.deleted_at IS 'Soft delete timestamp - 90 day retention, 1 year purge for compliance';
COMMENT ON COLUMN recoveries.deleted_at IS 'Soft delete timestamp - financial records retained 7 years';



-- ========================================
-- Migration: 045_expand_filing_status_enum.sql
-- ========================================


-- Migration: 045_expand_filing_status_enum.sql
-- Expands the allowed values for dispute_cases.filing_status to support hardening features

-- Drop the old constraint
ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;

-- Add the expanded constraint
ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
  CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed', 'quarantined_dangerous_doc', 'duplicate_blocked', 'already_reimbursed', 'pending_approval'));

-- Add comments for documentation
COMMENT ON COLUMN dispute_cases.filing_status IS 'Status of filing process: pending, filing, filed, retrying, failed, quarantined_dangerous_doc, duplicate_blocked, already_reimbursed, pending_approval';



-- ========================================
-- Migration: 046_create_default_tenant.sql
-- ========================================

-- ========================================
-- Migration: 046_create_default_tenant.sql
-- Multi-Tenant SaaS: Create Default Tenant for Existing Data
-- ========================================

-- Insert default tenant for migration of existing data
-- This tenant will own all pre-existing records

INSERT INTO tenants (
  id, 
  name, 
  slug, 
  status, 
  plan, 
  settings, 
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Tenant',
  'default',
  'active',
  'enterprise',  -- Give full access to existing users
  jsonb_build_object('migrated', true, 'migration_date', NOW()::TEXT),
  jsonb_build_object('is_default_tenant', true, 'created_by', 'migration')
) ON CONFLICT (id) DO NOTHING;

-- Also insert with slug conflict handling
INSERT INTO tenants (
  id, 
  name, 
  slug, 
  status, 
  plan
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Tenant',
  'default',
  'active',
  'enterprise'
) ON CONFLICT (slug) DO NOTHING;

-- Verify insertion
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Default tenant was not created - migration cannot proceed';
  END IF;
END $$;

-- Documentation
COMMENT ON TABLE tenants IS 'Multi-tenant SaaS organizations. ID 00000000-0000-0000-0000-000000000001 is the default tenant for migrated data.';



-- ========================================
-- Migration: 047_backfill_tenant_ids.sql
-- ========================================

-- ========================================
-- Migration: 047_backfill_tenant_ids.sql
-- Multi-Tenant SaaS: Populate tenant_id for All Existing Records
-- SAFE VERSION: Uses IF EXISTS checks for all tables
-- ========================================

-- Default tenant ID for backfill
-- All existing records will be assigned to this tenant

DO $$
DECLARE
  default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Verify default tenant exists
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = default_tenant_id) THEN
    RAISE EXCEPTION 'Default tenant does not exist - run migration 046 first';
  END IF;

  -- Core Data Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    UPDATE orders SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
    UPDATE shipments SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'returns') THEN
    UPDATE returns SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    UPDATE settlements SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    UPDATE inventory SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Financial Events & Detection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_events') THEN
    UPDATE financial_events SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_results') THEN
    UPDATE detection_results SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_queue') THEN
    UPDATE detection_queue SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_thresholds') THEN
    UPDATE detection_thresholds SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_whitelist') THEN
    UPDATE detection_whitelist SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Dispute System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_cases') THEN
    UPDATE dispute_cases SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_automation_rules') THEN
    UPDATE dispute_automation_rules SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence') THEN
    UPDATE dispute_evidence SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_audit_log') THEN
    UPDATE dispute_audit_log SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Evidence System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_sources') THEN
    UPDATE evidence_sources SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_documents') THEN
    UPDATE evidence_documents SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_line_items') THEN
    UPDATE evidence_line_items SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence_links') THEN
    UPDATE dispute_evidence_links SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proof_packets') THEN
    UPDATE proof_packets SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'smart_prompts') THEN
    UPDATE smart_prompts SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_match_results') THEN
    UPDATE evidence_match_results SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Recoveries
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recoveries') THEN
    UPDATE recoveries SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- System Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events') THEN
    UPDATE agent_events SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    UPDATE notifications SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_detection_triggers') THEN
    UPDATE sync_detection_triggers SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Access Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens') THEN
    UPDATE tokens SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    UPDATE users SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Worker tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'parser_jobs') THEN
    UPDATE parser_jobs SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_insights') THEN
    UPDATE learning_insights SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'threshold_optimizations') THEN
    UPDATE threshold_optimizations SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_snapshots') THEN
    UPDATE sync_snapshots SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'realtime_alerts') THEN
    UPDATE realtime_alerts SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'referral_invites') THEN
    UPDATE referral_invites SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_proxy_assignments') THEN
    UPDATE seller_proxy_assignments SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notes') THEN
    UPDATE user_notes SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_ingestion_errors') THEN
    UPDATE evidence_ingestion_errors SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_errors') THEN
    UPDATE billing_errors SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_submissions') THEN
    UPDATE dispute_submissions SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  RAISE NOTICE 'Backfill completed for default tenant: %', default_tenant_id;
END $$;

-- Create tenant memberships for existing users
INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active, accepted_at)
SELECT 
  '00000000-0000-0000-0000-000000000001',
  id,
  'owner',  -- Give existing users owner role
  TRUE,
  NOW()
FROM users
WHERE id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Log the backfill
INSERT INTO audit_logs (
  tenant_id,
  actor_type,
  action,
  resource_type,
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.tenant_backfill',
  'tenant',
  jsonb_build_object('migration', '047_backfill_tenant_ids', 'timestamp', NOW()::TEXT)
);



-- ========================================
-- Migration: 048_add_tenant_constraints.sql
-- ========================================

-- ========================================
-- Migration: 048_add_tenant_constraints.sql
-- Multi-Tenant SaaS: Add NOT NULL + Foreign Key Constraints
-- SAFE VERSION: Uses IF EXISTS checks for all tables
-- ========================================

-- After backfill, enforce tenant_id is required

DO $$
BEGIN
  -- Core Data Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    ALTER TABLE orders ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_orders_tenant') THEN
      ALTER TABLE orders ADD CONSTRAINT fk_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
    ALTER TABLE shipments ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_shipments_tenant') THEN
      ALTER TABLE shipments ADD CONSTRAINT fk_shipments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'returns') THEN
    ALTER TABLE returns ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_returns_tenant') THEN
      ALTER TABLE returns ADD CONSTRAINT fk_returns_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    ALTER TABLE settlements ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_settlements_tenant') THEN
      ALTER TABLE settlements ADD CONSTRAINT fk_settlements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    ALTER TABLE inventory ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_inventory_tenant') THEN
      ALTER TABLE inventory ADD CONSTRAINT fk_inventory_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Financial Events & Detection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_events') THEN
    ALTER TABLE financial_events ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_financial_events_tenant') THEN
      ALTER TABLE financial_events ADD CONSTRAINT fk_financial_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_results') THEN
    ALTER TABLE detection_results ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_detection_results_tenant') THEN
      ALTER TABLE detection_results ADD CONSTRAINT fk_detection_results_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_queue') THEN
    ALTER TABLE detection_queue ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_detection_queue_tenant') THEN
      ALTER TABLE detection_queue ADD CONSTRAINT fk_detection_queue_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_thresholds') THEN
    ALTER TABLE detection_thresholds ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_detection_thresholds_tenant') THEN
      ALTER TABLE detection_thresholds ADD CONSTRAINT fk_detection_thresholds_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_whitelist') THEN
    ALTER TABLE detection_whitelist ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_detection_whitelist_tenant') THEN
      ALTER TABLE detection_whitelist ADD CONSTRAINT fk_detection_whitelist_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Dispute System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_cases') THEN
    ALTER TABLE dispute_cases ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_cases_tenant') THEN
      ALTER TABLE dispute_cases ADD CONSTRAINT fk_dispute_cases_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_automation_rules') THEN
    ALTER TABLE dispute_automation_rules ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_automation_rules_tenant') THEN
      ALTER TABLE dispute_automation_rules ADD CONSTRAINT fk_dispute_automation_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence') THEN
    ALTER TABLE dispute_evidence ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_evidence_tenant') THEN
      ALTER TABLE dispute_evidence ADD CONSTRAINT fk_dispute_evidence_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_audit_log') THEN
    ALTER TABLE dispute_audit_log ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_audit_log_tenant') THEN
      ALTER TABLE dispute_audit_log ADD CONSTRAINT fk_dispute_audit_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Evidence System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_sources') THEN
    ALTER TABLE evidence_sources ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_evidence_sources_tenant') THEN
      ALTER TABLE evidence_sources ADD CONSTRAINT fk_evidence_sources_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_documents') THEN
    ALTER TABLE evidence_documents ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_evidence_documents_tenant') THEN
      ALTER TABLE evidence_documents ADD CONSTRAINT fk_evidence_documents_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_line_items') THEN
    ALTER TABLE evidence_line_items ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_evidence_line_items_tenant') THEN
      ALTER TABLE evidence_line_items ADD CONSTRAINT fk_evidence_line_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence_links') THEN
    ALTER TABLE dispute_evidence_links ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_evidence_links_tenant') THEN
      ALTER TABLE dispute_evidence_links ADD CONSTRAINT fk_dispute_evidence_links_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proof_packets') THEN
    ALTER TABLE proof_packets ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_proof_packets_tenant') THEN
      ALTER TABLE proof_packets ADD CONSTRAINT fk_proof_packets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'smart_prompts') THEN
    ALTER TABLE smart_prompts ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_smart_prompts_tenant') THEN
      ALTER TABLE smart_prompts ADD CONSTRAINT fk_smart_prompts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Recoveries
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recoveries') THEN
    ALTER TABLE recoveries ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_recoveries_tenant') THEN
      ALTER TABLE recoveries ADD CONSTRAINT fk_recoveries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- System Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events') THEN
    ALTER TABLE agent_events ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_agent_events_tenant') THEN
      ALTER TABLE agent_events ADD CONSTRAINT fk_agent_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    ALTER TABLE notifications ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_notifications_tenant') THEN
      ALTER TABLE notifications ADD CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_detection_triggers') THEN
    ALTER TABLE sync_detection_triggers ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_sync_detection_triggers_tenant') THEN
      ALTER TABLE sync_detection_triggers ADD CONSTRAINT fk_sync_detection_triggers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Access Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens') THEN
    ALTER TABLE tokens ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_tokens_tenant') THEN
      ALTER TABLE tokens ADD CONSTRAINT fk_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_users_tenant') THEN
      ALTER TABLE users ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_users_last_active_tenant') THEN
      ALTER TABLE users ADD CONSTRAINT fk_users_last_active_tenant FOREIGN KEY (last_active_tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  RAISE NOTICE 'Migration 048 completed - constraints added to all existing tables';
END $$;

-- Log constraint application
INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, event_type, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.tenant_constraints',
  'database',
  'migration',
  jsonb_build_object('migration', '048_add_tenant_constraints', 'timestamp', NOW()::TEXT)
);



-- ========================================
-- Migration: 049_add_tenant_indexes.sql
-- ========================================

-- ========================================
-- Migration: 049_add_tenant_indexes.sql
-- Multi-Tenant SaaS: Comprehensive Indexing Strategy
-- SAFE VERSION: Uses IF EXISTS checks for all tables
-- ========================================

DO $$
BEGIN
  -- Core Data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
    CREATE INDEX IF NOT EXISTS idx_shipments_tenant ON shipments(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'returns') THEN
    CREATE INDEX IF NOT EXISTS idx_returns_tenant ON returns(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    CREATE INDEX IF NOT EXISTS idx_settlements_tenant ON settlements(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory(tenant_id);
  END IF;

  -- Financial Events & Detection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_events') THEN
    CREATE INDEX IF NOT EXISTS idx_financial_events_tenant ON financial_events(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_results') THEN
    CREATE INDEX IF NOT EXISTS idx_detection_results_tenant ON detection_results(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_status ON detection_results(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_created ON detection_results(tenant_id, created_at DESC);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_queue') THEN
    CREATE INDEX IF NOT EXISTS idx_detection_queue_tenant ON detection_queue(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_thresholds') THEN
    CREATE INDEX IF NOT EXISTS idx_detection_thresholds_tenant ON detection_thresholds(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_whitelist') THEN
    CREATE INDEX IF NOT EXISTS idx_detection_whitelist_tenant ON detection_whitelist(tenant_id);
  END IF;

  -- Dispute System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_cases') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant ON dispute_cases(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_status ON dispute_cases(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_created ON dispute_cases(tenant_id, created_at DESC);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_automation_rules') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_automation_rules_tenant ON dispute_automation_rules(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_evidence_tenant ON dispute_evidence(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_audit_log') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_audit_log_tenant ON dispute_audit_log(tenant_id);
  END IF;

  -- Evidence System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_sources') THEN
    CREATE INDEX IF NOT EXISTS idx_evidence_sources_tenant ON evidence_sources(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_documents') THEN
    CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant ON evidence_documents(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant_date ON evidence_documents(tenant_id, document_date DESC);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_line_items') THEN
    CREATE INDEX IF NOT EXISTS idx_evidence_line_items_tenant ON evidence_line_items(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence_links') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_tenant ON dispute_evidence_links(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proof_packets') THEN
    CREATE INDEX IF NOT EXISTS idx_proof_packets_tenant ON proof_packets(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'smart_prompts') THEN
    CREATE INDEX IF NOT EXISTS idx_smart_prompts_tenant ON smart_prompts(tenant_id);
  END IF;

  -- Recoveries & System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recoveries') THEN
    CREATE INDEX IF NOT EXISTS idx_recoveries_tenant ON recoveries(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_recoveries_tenant_status ON recoveries(tenant_id, status);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events') THEN
    CREATE INDEX IF NOT EXISTS idx_agent_events_tenant ON agent_events(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_detection_triggers') THEN
    CREATE INDEX IF NOT EXISTS idx_sync_detection_triggers_tenant ON sync_detection_triggers(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens') THEN
    CREATE INDEX IF NOT EXISTS idx_tokens_tenant ON tokens(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
  END IF;

  -- Audit logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action ON audit_logs(tenant_id, action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_resource ON audit_logs(tenant_id, resource_type, resource_id);
  END IF;

  -- Tenant lifecycle
  CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(status) WHERE status = 'active' AND deleted_at IS NULL;

  RAISE NOTICE 'Migration 049 completed - indexes created for all existing tables';
END $$;

-- Log index creation
INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, event_type, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.tenant_indexes',
  'database',
  'migration',
  jsonb_build_object('migration', '049_add_tenant_indexes', 'timestamp', NOW()::TEXT)
);



-- ========================================
-- Migration: 050_update_rls_policies.sql
-- ========================================

-- ========================================
-- Migration: 050_update_rls_policies.sql
-- Multi-Tenant SaaS: Update RLS for Tenant Isolation
-- ========================================

-- New RLS pattern: Filter by tenant membership
-- Users can only see data from tenants they belong to

-- Helper function to get user's active tenant IDs
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS SETOF UUID AS $$
  SELECT tenant_id 
  FROM tenant_memberships 
  WHERE user_id = auth.uid() 
    AND is_active = TRUE 
    AND deleted_at IS NULL;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ========================================
-- Core Data Tables
-- ========================================

-- Financial Events
DROP POLICY IF EXISTS "Users can view their own financial events" ON financial_events;
CREATE POLICY "Tenant isolation for financial_events" ON financial_events
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Detection Results
DROP POLICY IF EXISTS "Users can view their own detection results" ON detection_results;
DROP POLICY IF EXISTS "Users can insert their own detection results" ON detection_results;
DROP POLICY IF EXISTS "Users can update their own detection results" ON detection_results;
CREATE POLICY "Tenant isolation for detection_results" ON detection_results
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Detection Queue
DROP POLICY IF EXISTS "Users can view their own detection queue items" ON detection_queue;
DROP POLICY IF EXISTS "Users can insert their own detection queue items" ON detection_queue;
DROP POLICY IF EXISTS "Users can update their own detection queue items" ON detection_queue;
CREATE POLICY "Tenant isolation for detection_queue" ON detection_queue
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Dispute System
-- ========================================

DROP POLICY IF EXISTS "Users can view their own dispute cases" ON dispute_cases;
DROP POLICY IF EXISTS "Users can insert their own dispute cases" ON dispute_cases;
DROP POLICY IF EXISTS "Users can update their own dispute cases" ON dispute_cases;
CREATE POLICY "Tenant isolation for dispute_cases" ON dispute_cases
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can view their own automation rules" ON dispute_automation_rules;
DROP POLICY IF EXISTS "Users can insert their own automation rules" ON dispute_automation_rules;
DROP POLICY IF EXISTS "Users can update their own automation rules" ON dispute_automation_rules;
CREATE POLICY "Tenant isolation for dispute_automation_rules" ON dispute_automation_rules
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Dispute Evidence (now has direct tenant_id)
DROP POLICY IF EXISTS "Users can view evidence for their own cases" ON dispute_evidence;
DROP POLICY IF EXISTS "Users can insert evidence for their own cases" ON dispute_evidence;
CREATE POLICY "Tenant isolation for dispute_evidence" ON dispute_evidence
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Dispute Audit Log
DROP POLICY IF EXISTS "Users can view audit logs for their own cases" ON dispute_audit_log;
CREATE POLICY "Tenant isolation for dispute_audit_log" ON dispute_audit_log
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Evidence System
-- ========================================

DROP POLICY IF EXISTS evidence_sources_owner_select ON evidence_sources;
DROP POLICY IF EXISTS evidence_sources_owner_insert ON evidence_sources;
DROP POLICY IF EXISTS evidence_sources_owner_update ON evidence_sources;
CREATE POLICY "Tenant isolation for evidence_sources" ON evidence_sources
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS evidence_documents_owner_select ON evidence_documents;
DROP POLICY IF EXISTS evidence_documents_owner_insert ON evidence_documents;
DROP POLICY IF EXISTS evidence_documents_owner_update ON evidence_documents;
CREATE POLICY "Tenant isolation for evidence_documents" ON evidence_documents
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS evidence_line_items_owner_select ON evidence_line_items;
DROP POLICY IF EXISTS evidence_line_items_owner_insert ON evidence_line_items;
DROP POLICY IF EXISTS evidence_line_items_owner_update ON evidence_line_items;
CREATE POLICY "Tenant isolation for evidence_line_items" ON evidence_line_items
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS dispute_evidence_links_dispute_scope ON dispute_evidence_links;
DROP POLICY IF EXISTS dispute_evidence_links_insert_scope ON dispute_evidence_links;
CREATE POLICY "Tenant isolation for dispute_evidence_links" ON dispute_evidence_links
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS proof_packets_owner_select ON proof_packets;
DROP POLICY IF EXISTS proof_packets_owner_insert ON proof_packets;
CREATE POLICY "Tenant isolation for proof_packets" ON proof_packets
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS smart_prompts_owner_select ON smart_prompts;
DROP POLICY IF EXISTS smart_prompts_owner_insert ON smart_prompts;
DROP POLICY IF EXISTS smart_prompts_owner_update ON smart_prompts;
CREATE POLICY "Tenant isolation for smart_prompts" ON smart_prompts
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Additional Tables
-- ========================================

-- Detection Thresholds
DROP POLICY IF EXISTS "Users can view their own thresholds" ON detection_thresholds;
DROP POLICY IF EXISTS "Users can insert their own thresholds" ON detection_thresholds;
DROP POLICY IF EXISTS "Users can update their own thresholds" ON detection_thresholds;
CREATE POLICY "Tenant isolation for detection_thresholds" ON detection_thresholds
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Detection Whitelist
DROP POLICY IF EXISTS "Users can view their own whitelist" ON detection_whitelist;
DROP POLICY IF EXISTS "Users can insert their own whitelist" ON detection_whitelist;
DROP POLICY IF EXISTS "Users can update their own whitelist" ON detection_whitelist;
CREATE POLICY "Tenant isolation for detection_whitelist" ON detection_whitelist
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Sync Detection Triggers
DROP POLICY IF EXISTS "Users can view their own sync triggers" ON sync_detection_triggers;
DROP POLICY IF EXISTS "Users can insert their own sync triggers" ON sync_detection_triggers;
DROP POLICY IF EXISTS "Users can update their own sync triggers" ON sync_detection_triggers;
CREATE POLICY "Tenant isolation for sync_detection_triggers" ON sync_detection_triggers
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Evidence Ingestion Errors
DROP POLICY IF EXISTS evidence_ingestion_errors_owner_select ON evidence_ingestion_errors;
CREATE POLICY "Tenant isolation for evidence_ingestion_errors" ON evidence_ingestion_errors
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Tokens Table (Critical for OAuth)
-- ========================================

-- RLS for tokens - users can only see tokens for their tenants
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for tokens" ON tokens;
CREATE POLICY "Tenant isolation for tokens" ON tokens
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Notifications
-- ========================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for notifications" ON notifications;
CREATE POLICY "Tenant isolation for notifications" ON notifications
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Recoveries
-- ========================================

ALTER TABLE recoveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for recoveries" ON recoveries;
CREATE POLICY "Tenant isolation for recoveries" ON recoveries
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Log RLS update
INSERT INTO audit_logs (
  tenant_id,
  actor_type,
  action,
  resource_type,
  event_type,
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.rls_update',
  'database',
  'migration',
  jsonb_build_object('migration', '050_update_rls_policies', 'timestamp', NOW()::TEXT)
);



-- ========================================
-- Migration: 051_create_lifecycle_triggers.sql
-- ========================================

-- ========================================
-- Migration: 051_create_lifecycle_triggers.sql
-- Multi-Tenant SaaS: Lifecycle Enforcement & Automation
-- ========================================

-- ========================================
-- Tenant Lifecycle Enforcement
-- ========================================

-- Function to check if tenant can write (not suspended/read-only/deleted)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
DECLARE
  tenant_status TEXT;
BEGIN
  -- Get tenant status
  SELECT status INTO tenant_status 
  FROM tenants 
  WHERE id = NEW.tenant_id;
  
  -- Block writes for inactive tenants
  IF tenant_status IN ('suspended', 'read_only', 'deleted') THEN
    RAISE EXCEPTION 'Operation blocked: Tenant is in % state', tenant_status
      USING HINT = 'Contact support to reactivate your account';
  END IF;
  
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Apply write protection to critical tables
CREATE TRIGGER enforce_tenant_active_dispute_cases
  BEFORE INSERT OR UPDATE ON dispute_cases
  FOR EACH ROW EXECUTE FUNCTION check_tenant_can_write();

CREATE TRIGGER enforce_tenant_active_detection_results
  BEFORE INSERT OR UPDATE ON detection_results
  FOR EACH ROW EXECUTE FUNCTION check_tenant_can_write();

CREATE TRIGGER enforce_tenant_active_recoveries
  BEFORE INSERT OR UPDATE ON recoveries
  FOR EACH ROW EXECUTE FUNCTION check_tenant_can_write();

CREATE TRIGGER enforce_tenant_active_evidence_documents
  BEFORE INSERT OR UPDATE ON evidence_documents
  FOR EACH ROW EXECUTE FUNCTION check_tenant_can_write();

-- ========================================
-- Soft Delete Cascade
-- ========================================

-- When a tenant is soft-deleted, cascade to related records
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
  -- Only trigger when deleted_at changes from NULL to a value
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- Soft delete all memberships
    UPDATE tenant_memberships 
    SET deleted_at = NEW.deleted_at, is_active = FALSE 
    WHERE tenant_id = NEW.id AND deleted_at IS NULL;
    
    -- Schedule data purge (90 days from now)
    NEW.data_purge_scheduled_at := NEW.deleted_at + INTERVAL '90 days';
    
    -- Log the deletion
    INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, resource_id, metadata)
    VALUES (
      NEW.id, 
      'system', 
      'tenant.soft_deleted', 
      'tenant', 
      NEW.id::TEXT,
      jsonb_build_object('deleted_at', NEW.deleted_at, 'purge_scheduled_at', NEW.data_purge_scheduled_at)
    );
  END IF;
  
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER tenant_soft_delete_cascade
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION cascade_tenant_soft_delete();

-- ========================================
-- Trial Expiration Handler
-- ========================================

-- Function to check and handle expired trials (called by scheduled job)
CREATE OR REPLACE FUNCTION handle_expired_trials()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  -- Update trialing tenants with expired trials to suspended
  WITH expired AS (
    UPDATE tenants
    SET status = 'suspended', updated_at = NOW()
    WHERE status = 'trialing' 
      AND trial_ends_at < NOW()
      AND deleted_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO expired_count FROM expired;
  
  -- Log each expiration
  INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, metadata)
  SELECT 
    id, 
    'system', 
    'tenant.trial_expired', 
    'tenant',
    jsonb_build_object('new_status', 'suspended', 'expired_at', NOW())
  FROM tenants
  WHERE status = 'suspended' 
    AND trial_ends_at < NOW()
    AND updated_at >= NOW() - INTERVAL '1 minute';
  
  RETURN expired_count;
END;
$function$ LANGUAGE plpgsql;

-- ========================================
-- Membership Audit Trigger
-- ========================================

-- Log all membership changes
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (tenant_id, actor_user_id, actor_type, action, resource_type, resource_id, payload_after)
    VALUES (
      NEW.tenant_id,
      NEW.invited_by,
      COALESCE(CASE WHEN NEW.invited_by IS NOT NULL THEN 'user' ELSE 'system' END, 'system'),
      'membership.created',
      'tenant_membership',
      NEW.id::TEXT,
      to_jsonb(NEW)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, resource_id, payload_before, payload_after)
    VALUES (
      NEW.tenant_id,
      'system',
      'membership.updated',
      'tenant_membership',
      NEW.id::TEXT,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, resource_id, payload_before)
    VALUES (
      OLD.tenant_id,
      'system',
      'membership.deleted',
      'tenant_membership',
      OLD.id::TEXT,
      to_jsonb(OLD)
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER audit_membership_changes
  AFTER INSERT OR UPDATE OR DELETE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION log_membership_changes();

-- ========================================
-- Plan Limits Enforcement (Optional - can be done in app layer)
-- ========================================

-- This is a placeholder for plan-based limits
-- In practice, this is often done in the application layer for flexibility
CREATE OR REPLACE FUNCTION get_tenant_plan_limits(tenant_uuid UUID)
RETURNS JSONB AS $$
DECLARE
  tenant_plan TEXT;
  limits JSONB;
BEGIN
  SELECT plan INTO tenant_plan FROM tenants WHERE id = tenant_uuid;
  
  limits := CASE tenant_plan
    WHEN 'free' THEN '{"max_amazon_accounts": 1, "max_monthly_recoveries": 10, "max_evidence_docs": 50}'::JSONB
    WHEN 'starter' THEN '{"max_amazon_accounts": 3, "max_monthly_recoveries": 100, "max_evidence_docs": 500}'::JSONB
    WHEN 'professional' THEN '{"max_amazon_accounts": 10, "max_monthly_recoveries": 1000, "max_evidence_docs": 5000}'::JSONB
    WHEN 'enterprise' THEN '{"max_amazon_accounts": -1, "max_monthly_recoveries": -1, "max_evidence_docs": -1}'::JSONB
    ELSE '{"max_amazon_accounts": 1, "max_monthly_recoveries": 10, "max_evidence_docs": 50}'::JSONB
  END;
  
  RETURN limits;
END;
$$ LANGUAGE plpgsql STABLE;

-- ========================================
-- Documentation
-- ========================================

COMMENT ON FUNCTION check_tenant_can_write() IS 'Blocks write operations for suspended/read-only/deleted tenants';
COMMENT ON FUNCTION cascade_tenant_soft_delete() IS 'Cascades soft delete to memberships and schedules data purge';
COMMENT ON FUNCTION handle_expired_trials() IS 'Scheduled function to suspend tenants with expired trials';
COMMENT ON FUNCTION get_tenant_plan_limits(UUID) IS 'Returns plan-based limits for a tenant';

-- Log migration completion
INSERT INTO audit_logs (
  tenant_id,
  actor_type,
  action,
  resource_type,
  event_type,
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.lifecycle_triggers',
  'database',
  'migration',
  jsonb_build_object('migration', '051_create_lifecycle_triggers', 'timestamp', NOW()::TEXT, 'status', 'complete')
);



-- ========================================
-- Migration: 055_product_costs_and_price_history.sql
-- ========================================

-- Migration 055: Product Costs and Price History Tables
-- For Agent 3 Reimbursement Underpayment Detection
-- Created: 2026-01-12

-- ============================================================================
-- 1. PRODUCT COSTS TABLE
-- Stores seller COGS (Cost of Goods Sold) per SKU
-- Source: manual input, uploaded invoices, or accounting integrations
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Product identifiers
    sku TEXT NOT NULL,
    asin TEXT,
    fnsku TEXT,
    product_name TEXT,
    
    -- Cost data
    cogs_value NUMERIC(12,2) NOT NULL,
    cost_currency TEXT DEFAULT 'USD',
    
    -- Source tracking
    source TEXT NOT NULL CHECK (source IN ('uploaded_invoice', 'manual_input', 'accounting_integration', 'estimated')),
    source_document_id UUID, -- FK to evidence_documents if from invoice
    source_reference TEXT, -- External reference (e.g., QuickBooks item ID)
    
    -- Validity period
    effective_date_start DATE,
    effective_date_end DATE,
    
    -- Confidence in the data
    confidence_score NUMERIC(3,2) DEFAULT 0.50 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    
    -- Audit timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    
    -- Ensure unique COGS per SKU per period
    UNIQUE(seller_id, sku, effective_date_start)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_product_costs_seller_id ON product_costs(seller_id);
CREATE INDEX IF NOT EXISTS idx_product_costs_tenant_id ON product_costs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_costs_sku ON product_costs(sku);
CREATE INDEX IF NOT EXISTS idx_product_costs_asin ON product_costs(asin);
CREATE INDEX IF NOT EXISTS idx_product_costs_fnsku ON product_costs(fnsku);
CREATE INDEX IF NOT EXISTS idx_product_costs_effective_dates ON product_costs(effective_date_start, effective_date_end);

COMMENT ON TABLE product_costs IS 'Stores seller COGS (Cost of Goods Sold) for reimbursement underpayment detection';

-- ============================================================================
-- 2. PRODUCT PRICE HISTORY TABLE
-- Stores rolling price metrics per SKU for fair market value calculation
-- Updated periodically from order history and Amazon pricing data
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Product identifiers
    sku TEXT NOT NULL,
    asin TEXT,
    fnsku TEXT,
    product_name TEXT,
    
    -- Rolling median prices (primary for fair value calculation)
    median_sale_price_30d NUMERIC(12,2),
    median_sale_price_90d NUMERIC(12,2),
    median_sale_price_180d NUMERIC(12,2),
    
    -- Average prices
    avg_sale_price_30d NUMERIC(12,2),
    avg_sale_price_90d NUMERIC(12,2),
    
    -- Price range
    min_sale_price_30d NUMERIC(12,2),
    max_sale_price_30d NUMERIC(12,2),
    
    -- Amazon listing prices
    buybox_price NUMERIC(12,2),
    list_price NUMERIC(12,2),
    
    -- Statistics for confidence calculations
    sample_count_30d INTEGER DEFAULT 0,
    sample_count_90d INTEGER DEFAULT 0,
    price_variance_30d NUMERIC(12,4), -- For outlier detection
    
    -- Metadata
    currency TEXT DEFAULT 'USD',
    last_order_date TIMESTAMPTZ,
    last_price_fetch TIMESTAMPTZ,
    
    -- Audit timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- One record per SKU per seller
    UNIQUE(seller_id, sku)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_product_price_history_seller_id ON product_price_history(seller_id);
CREATE INDEX IF NOT EXISTS idx_product_price_history_tenant_id ON product_price_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_price_history_sku ON product_price_history(sku);
CREATE INDEX IF NOT EXISTS idx_product_price_history_asin ON product_price_history(asin);
CREATE INDEX IF NOT EXISTS idx_product_price_history_updated ON product_price_history(updated_at);

COMMENT ON TABLE product_price_history IS 'Stores rolling price metrics for fair market value calculation in reimbursement detection';

-- ============================================================================
-- 3. REIMBURSEMENT ANALYSIS TABLE
-- Stores analysis results for each reimbursement event
-- Links reimbursements to expected values and detects underpayments
-- ============================================================================

CREATE TABLE IF NOT EXISTS reimbursement_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Link to original reimbursement
    reimbursement_id TEXT, -- From settlements/financial events
    settlement_id TEXT,
    order_id TEXT,
    
    -- Product info
    sku TEXT,
    asin TEXT,
    fnsku TEXT,
    quantity INTEGER DEFAULT 1,
    
    -- Actual vs Expected
    actual_reimbursement NUMERIC(12,2) NOT NULL,
    expected_fair_value NUMERIC(12,2), -- Based on median sale price
    seller_cogs NUMERIC(12,2), -- From product_costs
    
    -- Calculated fields
    expected_floor NUMERIC(12,2), -- median * 0.75
    expected_ceiling NUMERIC(12,2), -- median * 1.05
    shortfall_amount NUMERIC(12,2), -- expected - actual (if positive = underpaid)
    cogs_gap NUMERIC(12,2), -- COGS - actual (if positive = below cost)
    
    -- Detection flags
    is_below_floor BOOLEAN DEFAULT FALSE,
    is_below_cogs BOOLEAN DEFAULT FALSE,
    is_statistical_outlier BOOLEAN DEFAULT FALSE,
    is_historically_underpaid BOOLEAN DEFAULT FALSE,
    
    -- Confidence scoring
    confidence_score NUMERIC(3,2) DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    confidence_factors JSONB DEFAULT '{}',
    
    -- Classification
    severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    recommended_action TEXT CHECK (recommended_action IN ('no_action', 'review', 'file_claim', 'escalate')),
    
    -- Status tracking
    status TEXT DEFAULT 'detected' CHECK (status IN ('detected', 'reviewed', 'claim_filed', 'resolved', 'dismissed')),
    detection_result_id UUID, -- Link to detection_results if claim generated
    
    -- Currency
    currency TEXT DEFAULT 'USD',
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_seller ON reimbursement_analysis(seller_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_tenant ON reimbursement_analysis(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_sku ON reimbursement_analysis(sku);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_status ON reimbursement_analysis(status);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_severity ON reimbursement_analysis(severity);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_shortfall ON reimbursement_analysis(shortfall_amount) WHERE shortfall_amount > 0;

COMMENT ON TABLE reimbursement_analysis IS 'Stores reimbursement underpayment analysis results for Agent 3 detection';

-- ============================================================================
-- 4. ENABLE RLS
-- ============================================================================

ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursement_analysis ENABLE ROW LEVEL SECURITY;

-- RLS Policies for product_costs
CREATE POLICY product_costs_tenant_isolation ON product_costs
    FOR ALL USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.current_tenant_id', true) IS NULL
    );

-- RLS Policies for product_price_history
CREATE POLICY product_price_history_tenant_isolation ON product_price_history
    FOR ALL USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.current_tenant_id', true) IS NULL
    );

-- RLS Policies for reimbursement_analysis
CREATE POLICY reimbursement_analysis_tenant_isolation ON reimbursement_analysis
    FOR ALL USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.current_tenant_id', true) IS NULL
    );

-- ============================================================================
-- 5. UPDATE TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

CREATE TRIGGER update_product_costs_updated_at
    BEFORE UPDATE ON product_costs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_product_price_history_updated_at
    BEFORE UPDATE ON product_price_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reimbursement_analysis_updated_at
    BEFORE UPDATE ON reimbursement_analysis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();



-- ========================================
-- Migration: 056_create_waitlist_table.sql
-- ========================================

-- Migration: Create Waitlist Table
-- Description: Stores signups for the platform waitlist

CREATE TABLE IF NOT EXISTS public.waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    company_name TEXT,
    monthly_volume TEXT,
    referral_source TEXT,
    status TEXT DEFAULT 'pending', -- pending, invited, joined
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS waitlist_email_idx ON public.waitlist(email);

-- Enable Row Level Security
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Allow public to insert into waitlist (for the landing page form)
CREATE POLICY "Allow public insert into waitlist" ON public.waitlist
    FOR INSERT WITH CHECK (true);

-- Allow admins to view/manage waitlist
-- Assuming we use service role or a specific admin check
CREATE POLICY "Allow service role full access to waitlist" ON public.waitlist
    FOR ALL USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$ LANGUAGE plpgsql;

-- Trigger to call the function
CREATE TRIGGER update_waitlist_updated_at_trigger
    BEFORE UPDATE ON public.waitlist
    FOR EACH ROW
    EXECUTE FUNCTION update_waitlist_updated_at();



-- ========================================
-- Migration: 057_update_waitlist_fields.sql
-- ========================================

-- Migration: Update Waitlist Fields
-- Description: Adds new fields for lead categorization and sorting

ALTER TABLE public.waitlist 
ADD COLUMN IF NOT EXISTS user_type TEXT,
ADD COLUMN IF NOT EXISTS brand_count TEXT,
ADD COLUMN IF NOT EXISTS annual_revenue TEXT,
ADD COLUMN IF NOT EXISTS contact_handle TEXT,
ADD COLUMN IF NOT EXISTS primary_goal TEXT;

-- Add a comment for documentation
COMMENT ON COLUMN public.waitlist.user_type IS 'Type of user: Brand Owner, Agency, Investor, etc.';
COMMENT ON COLUMN public.waitlist.brand_count IS 'Number of brands managed (typically for agencies)';
COMMENT ON COLUMN public.waitlist.annual_revenue IS 'Estimated annual revenue band';
COMMENT ON COLUMN public.waitlist.contact_handle IS 'WhatsApp, Telegram, or other social handle';
COMMENT ON COLUMN public.waitlist.primary_goal IS 'Primary goal: Recover profit, Audit, Automate, etc.';



-- ========================================
-- Migration: 058_relax_tokens_provider_check.sql
-- ========================================

-- Migration 058: Relax Tokens Provider Check
-- Created: 2026-02-07
-- Purpose: Remove restrictive provider CHECK constraint to support new integrations (Google Drive, Outlook, Dropbox)

DO $$
BEGIN
    -- Drop the provider CHECK constraint if it exists
    -- Migration 020 created it as: CHECK (provider IN ('amazon', 'gmail', 'stripe'))
    ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_provider_check;
    
    -- Also try common naming patterns if the above fails
    EXECUTE (
        SELECT string_agg('ALTER TABLE tokens DROP CONSTRAINT IF EXISTS ' || quote_ident(conname) || ';', ' ')
        FROM pg_constraint
        WHERE conrelid = 'tokens'::regclass
        AND conname LIKE '%provider%'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not drop tokens provider constraint: %', SQLERRM;
END $$;

-- Add a comment to the table to document the change
COMMENT ON COLUMN tokens.provider IS 'Provider ID (e.g., amazon, gmail, stripe, gdrive, outlook, dropbox)';

-- Log the migration
INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, metadata)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'system',
    'migration.relax_tokens_provider',
    'database',
    jsonb_build_object('migration', '058_relax_tokens_provider_check', 'timestamp', NOW()::TEXT)
) ON CONFLICT DO NOTHING;



-- ========================================
-- Migration: 059_automation_tracking.sql
-- ========================================

-- Migration: 059_automation_tracking.sql
-- Adds submission tracking to claims and dispute_cases for Agent 7 automation

-- Update dispute_cases (Primary for Agent 7)
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS amazon_case_id VARCHAR(255);
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS submission_attempts INT DEFAULT 0;
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS last_submission_attempt TIMESTAMP WITH TIME ZONE;
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS evidence_attachments JSONB DEFAULT '[]';

-- Update claims (Frontend Visibility)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS amazon_case_id VARCHAR(255);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS submission_attempts INT DEFAULT 0;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_submission_attempt TIMESTAMP WITH TIME ZONE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS evidence_attachments JSONB DEFAULT '[]';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dispute_cases_amazon_case_id ON dispute_cases(amazon_case_id);
CREATE INDEX IF NOT EXISTS idx_claims_amazon_case_id ON claims(amazon_case_id);


