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
CREATE OR REPLACE FUNCTION update_alerts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_alerts_updated
  BEFORE UPDATE ON realtime_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_alerts_timestamp();

-- Enable Realtime for this table (so we can push alerts to frontend)
ALTER PUBLICATION supabase_realtime ADD TABLE realtime_alerts;
