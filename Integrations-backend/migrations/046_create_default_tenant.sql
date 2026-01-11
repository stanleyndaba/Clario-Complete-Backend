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
