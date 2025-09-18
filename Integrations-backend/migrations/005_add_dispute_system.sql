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

