-- Create audit_logs table for security event logging
-- This table stores all security-related events including authentication, token operations, and security incidents

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  user_id UUID,
  ip_address INET,
  user_agent TEXT,
  provider VARCHAR(50),
  metadata JSONB,
  severity VARCHAR(20) DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs (severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_provider ON audit_logs (provider);

-- Create index on metadata for JSONB queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_metadata ON audit_logs USING GIN (metadata);

-- Add comment to table
COMMENT ON TABLE audit_logs IS 'Audit log table for security events, authentication, and token operations';
COMMENT ON COLUMN audit_logs.event_type IS 'Type of event (e.g., auth_login, token_rotated, security_invalid_redirect_uri)';
COMMENT ON COLUMN audit_logs.severity IS 'Severity level: low, medium, high, critical';
COMMENT ON COLUMN audit_logs.metadata IS 'Additional event metadata (JSON)';

-- Add RLS (Row Level Security) policy if needed
-- ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY audit_logs_select ON audit_logs FOR SELECT USING (true); -- Allow all selects for now

