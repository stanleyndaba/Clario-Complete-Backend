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
CREATE POLICY "Service can manage proxy assignments" ON seller_proxy_assignments
  FOR ALL USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_seller_proxy_assignments_updated_at 
  BEFORE UPDATE ON seller_proxy_assignments 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE seller_proxy_assignments IS 'Maps sellers to dedicated proxy sessions to prevent IP contamination and chain bans';
COMMENT ON COLUMN seller_proxy_assignments.proxy_session_id IS 'Sticky session ID for residential proxy - ensures consistent IP per seller';
COMMENT ON COLUMN seller_proxy_assignments.last_known_ip IS 'Last IP address used for this seller (for audit purposes)';
