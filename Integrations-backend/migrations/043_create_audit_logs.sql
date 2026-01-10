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
