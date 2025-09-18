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



