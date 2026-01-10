-- ========================================
-- Migration: 051_create_lifecycle_triggers.sql
-- Multi-Tenant SaaS: Lifecycle Enforcement & Automation
-- ========================================

-- ========================================
-- Tenant Lifecycle Enforcement
-- ========================================

-- Function to check if tenant can write (not suspended/read-only/deleted)
CREATE OR REPLACE FUNCTION check_tenant_can_write()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

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
CREATE OR REPLACE FUNCTION cascade_tenant_soft_delete()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

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
$$ LANGUAGE plpgsql;

-- ========================================
-- Membership Audit Trigger
-- ========================================

-- Log all membership changes
CREATE OR REPLACE FUNCTION log_membership_changes()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

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
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.lifecycle_triggers',
  'database',
  '{"migration": "051_create_lifecycle_triggers", "timestamp": "' || NOW()::TEXT || '", "status": "complete"}'
);
