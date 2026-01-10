-- ========================================
-- Migration: 042_create_tenants_table.sql
-- Multi-Tenant SaaS: Core Tenant Model
-- ========================================

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

-- Trigger for updated_at
CREATE TRIGGER update_tenants_updated_at 
  BEFORE UPDATE ON tenants 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
