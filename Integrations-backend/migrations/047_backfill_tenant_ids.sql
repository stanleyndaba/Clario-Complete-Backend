-- ========================================
-- Migration: 047_backfill_tenant_ids.sql
-- Multi-Tenant SaaS: Populate tenant_id for All Existing Records
-- SAFE VERSION: Uses IF EXISTS checks for all tables
-- ========================================

-- Default tenant ID for backfill
-- All existing records will be assigned to this tenant

DO $$
DECLARE
  default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Verify default tenant exists
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = default_tenant_id) THEN
    RAISE EXCEPTION 'Default tenant does not exist - run migration 046 first';
  END IF;

  -- Core Data Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    UPDATE orders SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
    UPDATE shipments SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'returns') THEN
    UPDATE returns SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    UPDATE settlements SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    UPDATE inventory SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Financial Events & Detection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_events') THEN
    UPDATE financial_events SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_results') THEN
    UPDATE detection_results SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_queue') THEN
    UPDATE detection_queue SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_thresholds') THEN
    UPDATE detection_thresholds SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_whitelist') THEN
    UPDATE detection_whitelist SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Dispute System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_cases') THEN
    UPDATE dispute_cases SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_automation_rules') THEN
    UPDATE dispute_automation_rules SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence') THEN
    UPDATE dispute_evidence SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_audit_log') THEN
    UPDATE dispute_audit_log SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Evidence System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_sources') THEN
    UPDATE evidence_sources SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_documents') THEN
    UPDATE evidence_documents SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_line_items') THEN
    UPDATE evidence_line_items SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence_links') THEN
    UPDATE dispute_evidence_links SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proof_packets') THEN
    UPDATE proof_packets SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'smart_prompts') THEN
    UPDATE smart_prompts SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_match_results') THEN
    UPDATE evidence_match_results SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Recoveries
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recoveries') THEN
    UPDATE recoveries SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- System Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events') THEN
    UPDATE agent_events SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    UPDATE notifications SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_detection_triggers') THEN
    UPDATE sync_detection_triggers SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Access Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens') THEN
    UPDATE tokens SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    UPDATE users SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  -- Worker tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'parser_jobs') THEN
    UPDATE parser_jobs SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_insights') THEN
    UPDATE learning_insights SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'threshold_optimizations') THEN
    UPDATE threshold_optimizations SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_snapshots') THEN
    UPDATE sync_snapshots SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'realtime_alerts') THEN
    UPDATE realtime_alerts SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'referral_invites') THEN
    UPDATE referral_invites SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_proxy_assignments') THEN
    UPDATE seller_proxy_assignments SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notes') THEN
    UPDATE user_notes SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_ingestion_errors') THEN
    UPDATE evidence_ingestion_errors SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_errors') THEN
    UPDATE billing_errors SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_submissions') THEN
    UPDATE dispute_submissions SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  END IF;

  RAISE NOTICE 'Backfill completed for default tenant: %', default_tenant_id;
END $$;

-- Create tenant memberships for existing users
INSERT INTO tenant_memberships (tenant_id, user_id, role, is_active, accepted_at)
SELECT 
  '00000000-0000-0000-0000-000000000001',
  id,
  'owner',  -- Give existing users owner role
  TRUE,
  NOW()
FROM users
WHERE id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Log the backfill
INSERT INTO audit_logs (
  tenant_id,
  actor_type,
  action,
  resource_type,
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.tenant_backfill',
  'tenant',
  jsonb_build_object('migration', '047_backfill_tenant_ids', 'timestamp', NOW()::TEXT)
);
