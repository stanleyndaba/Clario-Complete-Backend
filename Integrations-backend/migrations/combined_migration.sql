-- Combined Migration Script
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/uuuqpujtnubusmigbkvw/sql/new


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

-- Add missing columns to financial_events if table already exists
DO $$
BEGIN
  -- Add raw_payload if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'raw_payload'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
  
  -- Add amount if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'amount'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN amount DECIMAL(10,2);
  END IF;
  
  -- Add currency if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'currency'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN currency TEXT DEFAULT 'USD';
  END IF;
  
  -- Add event_type if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'event_type'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN event_type TEXT;
  END IF;
  
  -- Add amazon_event_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'amazon_event_id'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN amazon_event_id TEXT;
  END IF;
  
  -- Add amazon_order_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'amazon_order_id'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN amazon_order_id TEXT;
  END IF;
  
  -- Add amazon_sku if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'amazon_sku'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN amazon_sku TEXT;
  END IF;
  
  -- Add event_date if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'event_date'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN event_date TIMESTAMP WITH TIME ZONE;
  END IF;
  
  -- Add created_at if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'created_at'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
  
  -- Add updated_at if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'financial_events' 
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE financial_events ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  END IF;
END$$;

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

-- Drop existing RLS policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own financial events" ON financial_events;
DROP POLICY IF EXISTS "Users can insert their own financial events" ON financial_events;
DROP POLICY IF EXISTS "Users can update their own financial events" ON financial_events;
DROP POLICY IF EXISTS "Users can view their own detection results" ON detection_results;
DROP POLICY IF EXISTS "Users can insert their own detection results" ON detection_results;
DROP POLICY IF EXISTS "Users can update their own detection results" ON detection_results;
DROP POLICY IF EXISTS "Users can view their own detection queue items" ON detection_queue;
DROP POLICY IF EXISTS "Users can insert their own detection queue items" ON detection_queue;
DROP POLICY IF EXISTS "Users can update their own detection queue items" ON detection_queue;

-- RLS policies for financial_events (with explicit type casting)
CREATE POLICY "Users can view their own financial events" ON financial_events
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can insert their own financial events" ON financial_events
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can update their own financial events" ON financial_events
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

-- RLS policies for detection_results (with explicit type casting)
CREATE POLICY "Users can view their own detection results" ON detection_results
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can insert their own detection results" ON detection_results
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can update their own detection results" ON detection_results
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

-- RLS policies for detection_queue (with explicit type casting)
CREATE POLICY "Users can view their own detection queue items" ON detection_queue
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can insert their own detection queue items" ON detection_queue
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can update their own detection queue items" ON detection_queue
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

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

-- Fix detection_results table if it has INTEGER id instead of UUID
-- This MUST run before creating dispute_cases with foreign key reference
DO $$
BEGIN
  -- Check if detection_results exists with INTEGER id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'detection_results' 
    AND column_name = 'id' 
    AND data_type = 'integer'
  ) THEN
    -- Drop dependent tables that might reference it
    DROP TABLE IF EXISTS dispute_cases CASCADE;
    DROP TABLE IF EXISTS dispute_evidence CASCADE;
    DROP TABLE IF EXISTS dispute_audit_log CASCADE;
    
    -- Drop and recreate detection_results with UUID
    -- WARNING: This will delete all data in detection_results!
    DROP TABLE IF EXISTS detection_results CASCADE;
    
    -- Recreate with correct UUID type
    CREATE TABLE detection_results (
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
    
    -- Recreate indexes
    CREATE INDEX IF NOT EXISTS idx_detection_results_seller_id ON detection_results(seller_id);
    CREATE INDEX IF NOT EXISTS idx_detection_results_sync_id ON detection_results(sync_id);
    CREATE INDEX IF NOT EXISTS idx_detection_results_anomaly_type ON detection_results(anomaly_type);
    CREATE INDEX IF NOT EXISTS idx_detection_results_severity ON detection_results(severity);
    CREATE INDEX IF NOT EXISTS idx_detection_results_status ON detection_results(status);
    CREATE INDEX IF NOT EXISTS idx_detection_results_created_at ON detection_results(created_at);
    
    -- Re-enable RLS
    ALTER TABLE detection_results ENABLE ROW LEVEL SECURITY;
    
    -- Recreate RLS policies
    DROP POLICY IF EXISTS "Users can view their own detection results" ON detection_results;
    DROP POLICY IF EXISTS "Users can insert their own detection results" ON detection_results;
    DROP POLICY IF EXISTS "Users can update their own detection results" ON detection_results;
    
    CREATE POLICY "Users can view their own detection results" ON detection_results
      FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
    CREATE POLICY "Users can insert their own detection results" ON detection_results
      FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
    CREATE POLICY "Users can update their own detection results" ON detection_results
      FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;
END$$;

-- Fix detection_queue table if it has INTEGER id instead of UUID
-- This MUST run before creating sync_detection_triggers with foreign key reference
DO $$
BEGIN
  -- Check if detection_queue exists with INTEGER id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'detection_queue' 
    AND column_name = 'id' 
    AND data_type = 'integer'
  ) THEN
    -- Drop dependent tables that might reference it
    DROP TABLE IF EXISTS sync_detection_triggers CASCADE;
    
    -- Drop and recreate detection_queue with UUID
    -- WARNING: This will delete all data in detection_queue!
    DROP TABLE IF EXISTS detection_queue CASCADE;
    
    -- Recreate with correct UUID type
    CREATE TABLE detection_queue (
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
    
    -- Recreate indexes
    CREATE INDEX IF NOT EXISTS idx_detection_queue_seller_id ON detection_queue(seller_id);
    CREATE INDEX IF NOT EXISTS idx_detection_queue_sync_id ON detection_queue(sync_id);
    CREATE INDEX IF NOT EXISTS idx_detection_queue_status ON detection_queue(status);
    CREATE INDEX IF NOT EXISTS idx_detection_queue_priority ON detection_queue(priority);
    CREATE INDEX IF NOT EXISTS idx_detection_queue_created_at ON detection_queue(created_at);
    
    -- Re-enable RLS
    ALTER TABLE detection_queue ENABLE ROW LEVEL SECURITY;
    
    -- Recreate RLS policies
    DROP POLICY IF EXISTS "Users can view their own detection queue items" ON detection_queue;
    DROP POLICY IF EXISTS "Users can insert their own detection queue items" ON detection_queue;
    DROP POLICY IF EXISTS "Users can update their own detection queue items" ON detection_queue;
    
    CREATE POLICY "Users can view their own detection queue items" ON detection_queue
      FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
    CREATE POLICY "Users can insert their own detection queue items" ON detection_queue
      FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
    CREATE POLICY "Users can update their own detection queue items" ON detection_queue
      FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
  END IF;
END$$;

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

-- Drop existing RLS policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own dispute cases" ON dispute_cases;
DROP POLICY IF EXISTS "Users can insert their own dispute cases" ON dispute_cases;
DROP POLICY IF EXISTS "Users can update their own dispute cases" ON dispute_cases;
DROP POLICY IF EXISTS "Users can view their own automation rules" ON dispute_automation_rules;
DROP POLICY IF EXISTS "Users can insert their own automation rules" ON dispute_automation_rules;
DROP POLICY IF EXISTS "Users can update their own automation rules" ON dispute_automation_rules;

-- RLS policies for dispute_cases (with explicit type casting)
CREATE POLICY "Users can view their own dispute cases" ON dispute_cases
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can insert their own dispute cases" ON dispute_cases
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can update their own dispute cases" ON dispute_cases
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

-- RLS policies for dispute_automation_rules (with explicit type casting)
CREATE POLICY "Users can view their own automation rules" ON dispute_automation_rules
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can insert their own automation rules" ON dispute_automation_rules
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can update their own automation rules" ON dispute_automation_rules
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

-- RLS policies for dispute_evidence
CREATE POLICY "Users can view evidence for their own cases" ON dispute_evidence
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM dispute_cases 
      WHERE dispute_cases.id = dispute_evidence.dispute_case_id 
      AND CAST(dispute_cases.seller_id AS TEXT) = CAST(auth.uid() AS TEXT)
    )
  );

CREATE POLICY "Users can insert evidence for their own cases" ON dispute_evidence
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM dispute_cases 
      WHERE dispute_cases.id = dispute_evidence.dispute_case_id 
      AND CAST(dispute_cases.seller_id AS TEXT) = CAST(auth.uid() AS TEXT)
    )
  );

-- RLS policies for dispute_audit_log
CREATE POLICY "Users can view audit logs for their own cases" ON dispute_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM dispute_cases 
      WHERE dispute_cases.id = dispute_audit_log.dispute_case_id 
      AND CAST(dispute_cases.seller_id AS TEXT) = CAST(auth.uid() AS TEXT)
    )
  );

-- Drop existing RLS policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own thresholds" ON detection_thresholds;
DROP POLICY IF EXISTS "Users can insert their own thresholds" ON detection_thresholds;
DROP POLICY IF EXISTS "Users can update their own thresholds" ON detection_thresholds;
DROP POLICY IF EXISTS "Users can view their own whitelist" ON detection_whitelist;
DROP POLICY IF EXISTS "Users can insert their own whitelist" ON detection_whitelist;
DROP POLICY IF EXISTS "Users can update their own whitelist" ON detection_whitelist;
DROP POLICY IF EXISTS "Users can view their own sync triggers" ON sync_detection_triggers;
DROP POLICY IF EXISTS "Users can insert their own sync triggers" ON sync_detection_triggers;
DROP POLICY IF EXISTS "Users can update their own sync triggers" ON sync_detection_triggers;

-- RLS policies for detection_thresholds (with explicit type casting)
CREATE POLICY "Users can view their own thresholds" ON detection_thresholds
  FOR SELECT USING (seller_id IS NULL OR CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can insert their own thresholds" ON detection_thresholds
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can update their own thresholds" ON detection_thresholds
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

-- RLS policies for detection_whitelist (with explicit type casting)
CREATE POLICY "Users can view their own whitelist" ON detection_whitelist
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can insert their own whitelist" ON detection_whitelist
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can update their own whitelist" ON detection_whitelist
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

-- RLS policies for sync_detection_triggers (with explicit type casting)
CREATE POLICY "Users can view their own sync triggers" ON sync_detection_triggers
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can insert their own sync triggers" ON sync_detection_triggers
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY "Users can update their own sync triggers" ON sync_detection_triggers
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

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
-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS evidence_sources_owner_select ON evidence_sources;
DROP POLICY IF EXISTS evidence_sources_owner_insert ON evidence_sources;
DROP POLICY IF EXISTS evidence_sources_owner_update ON evidence_sources;
DROP POLICY IF EXISTS evidence_documents_owner_select ON evidence_documents;
DROP POLICY IF EXISTS evidence_documents_owner_insert ON evidence_documents;
DROP POLICY IF EXISTS evidence_documents_owner_update ON evidence_documents;

CREATE POLICY evidence_sources_owner_select ON evidence_sources FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
CREATE POLICY evidence_sources_owner_insert ON evidence_sources FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
CREATE POLICY evidence_sources_owner_update ON evidence_sources FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

CREATE POLICY evidence_documents_owner_select ON evidence_documents FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
CREATE POLICY evidence_documents_owner_insert ON evidence_documents FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
CREATE POLICY evidence_documents_owner_update ON evidence_documents FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS dispute_evidence_links_dispute_scope ON dispute_evidence_links;
DROP POLICY IF EXISTS dispute_evidence_links_insert_scope ON dispute_evidence_links;

CREATE POLICY dispute_evidence_links_dispute_scope ON dispute_evidence_links FOR SELECT USING (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = dispute_evidence_links.dispute_case_id AND CAST(d.seller_id AS TEXT) = CAST(auth.uid() AS TEXT))
);
CREATE POLICY dispute_evidence_links_insert_scope ON dispute_evidence_links FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = dispute_evidence_links.dispute_case_id AND CAST(d.seller_id AS TEXT) = CAST(auth.uid() AS TEXT))
);

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS proof_packets_owner_select ON proof_packets;
DROP POLICY IF EXISTS proof_packets_owner_insert ON proof_packets;

CREATE POLICY proof_packets_owner_select ON proof_packets FOR SELECT USING (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = proof_packets.dispute_case_id AND CAST(d.seller_id AS TEXT) = CAST(auth.uid() AS TEXT))
);
CREATE POLICY proof_packets_owner_insert ON proof_packets FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = proof_packets.dispute_case_id AND CAST(d.seller_id AS TEXT) = CAST(auth.uid() AS TEXT))
);

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS smart_prompts_owner_select ON smart_prompts;
DROP POLICY IF EXISTS smart_prompts_owner_insert ON smart_prompts;
DROP POLICY IF EXISTS smart_prompts_owner_update ON smart_prompts;

CREATE POLICY smart_prompts_owner_select ON smart_prompts FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
CREATE POLICY smart_prompts_owner_insert ON smart_prompts FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
CREATE POLICY smart_prompts_owner_update ON smart_prompts FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));





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
-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS evidence_line_items_owner_select ON evidence_line_items;
DROP POLICY IF EXISTS evidence_line_items_owner_insert ON evidence_line_items;
DROP POLICY IF EXISTS evidence_line_items_owner_update ON evidence_line_items;

CREATE POLICY evidence_line_items_owner_select ON evidence_line_items FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
CREATE POLICY evidence_line_items_owner_insert ON evidence_line_items FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));





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
    SELECT 1 FROM pg_policies WHERE policyname = 'evidence_line_items_owner_update'
  ) THEN
    CREATE POLICY evidence_line_items_owner_update ON evidence_line_items FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(seller_id AS TEXT));
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

-- Drop existing policy if it exists (to avoid conflicts)
DROP POLICY IF EXISTS evidence_ingestion_errors_owner_select ON evidence_ingestion_errors;

-- Create RLS policy with explicit type casting (cast both sides to text to avoid type mismatch)
CREATE POLICY evidence_ingestion_errors_owner_select 
ON evidence_ingestion_errors FOR SELECT 
USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));



