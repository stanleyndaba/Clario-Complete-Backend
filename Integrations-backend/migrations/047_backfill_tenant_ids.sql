-- ========================================
-- Migration: 047_backfill_tenant_ids.sql
-- Multi-Tenant SaaS: Populate tenant_id for All Existing Records
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
  UPDATE orders SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE shipments SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE returns SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE settlements SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE inventory SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  -- Financial Events & Detection
  UPDATE financial_events SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE detection_results SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE detection_queue SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE detection_thresholds SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE detection_whitelist SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  -- Dispute System
  UPDATE dispute_cases SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE dispute_automation_rules SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE dispute_evidence SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE dispute_audit_log SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  -- Evidence System
  UPDATE evidence_sources SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE evidence_documents SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE evidence_line_items SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE dispute_evidence_links SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE proof_packets SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE smart_prompts SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  -- Recoveries
  UPDATE recoveries SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  -- System Tables
  UPDATE agent_events SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE notifications SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE sync_detection_triggers SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  -- Access Tables
  UPDATE tokens SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE users SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  RAISE NOTICE 'Backfill completed for default tenant: %', default_tenant_id;
END $$;

-- Backfill tables that may not exist (safe execution)
DO $$
DECLARE
  default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Optional tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_match_results') THEN
    EXECUTE 'UPDATE evidence_match_results SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'parser_jobs') THEN
    EXECUTE 'UPDATE parser_jobs SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_insights') THEN
    EXECUTE 'UPDATE learning_insights SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'threshold_optimizations') THEN
    EXECUTE 'UPDATE threshold_optimizations SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_snapshots') THEN
    EXECUTE 'UPDATE sync_snapshots SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'realtime_alerts') THEN
    EXECUTE 'UPDATE realtime_alerts SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'referral_invites') THEN
    EXECUTE 'UPDATE referral_invites SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_proxy_assignments') THEN
    EXECUTE 'UPDATE seller_proxy_assignments SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notes') THEN
    EXECUTE 'UPDATE user_notes SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_ingestion_errors') THEN
    EXECUTE 'UPDATE evidence_ingestion_errors SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_errors') THEN
    EXECUTE 'UPDATE billing_errors SET tenant_id = $1 WHERE tenant_id IS NULL' USING default_tenant_id;
  END IF;
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
  '{"migration": "047_backfill_tenant_ids", "timestamp": "' || NOW()::TEXT || '"}'
);
