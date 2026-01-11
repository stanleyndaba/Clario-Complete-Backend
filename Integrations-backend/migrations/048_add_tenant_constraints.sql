-- ========================================
-- Migration: 048_add_tenant_constraints.sql
-- Multi-Tenant SaaS: Add NOT NULL + Foreign Key Constraints
-- SAFE VERSION: Uses IF EXISTS checks for all tables
-- ========================================

-- After backfill, enforce tenant_id is required

DO $$
BEGIN
  -- Core Data Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    ALTER TABLE orders ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_orders_tenant') THEN
      ALTER TABLE orders ADD CONSTRAINT fk_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
    ALTER TABLE shipments ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_shipments_tenant') THEN
      ALTER TABLE shipments ADD CONSTRAINT fk_shipments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'returns') THEN
    ALTER TABLE returns ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_returns_tenant') THEN
      ALTER TABLE returns ADD CONSTRAINT fk_returns_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    ALTER TABLE settlements ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_settlements_tenant') THEN
      ALTER TABLE settlements ADD CONSTRAINT fk_settlements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    ALTER TABLE inventory ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_inventory_tenant') THEN
      ALTER TABLE inventory ADD CONSTRAINT fk_inventory_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Financial Events & Detection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_events') THEN
    ALTER TABLE financial_events ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_financial_events_tenant') THEN
      ALTER TABLE financial_events ADD CONSTRAINT fk_financial_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_results') THEN
    ALTER TABLE detection_results ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_detection_results_tenant') THEN
      ALTER TABLE detection_results ADD CONSTRAINT fk_detection_results_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_queue') THEN
    ALTER TABLE detection_queue ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_detection_queue_tenant') THEN
      ALTER TABLE detection_queue ADD CONSTRAINT fk_detection_queue_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_thresholds') THEN
    ALTER TABLE detection_thresholds ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_detection_thresholds_tenant') THEN
      ALTER TABLE detection_thresholds ADD CONSTRAINT fk_detection_thresholds_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_whitelist') THEN
    ALTER TABLE detection_whitelist ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_detection_whitelist_tenant') THEN
      ALTER TABLE detection_whitelist ADD CONSTRAINT fk_detection_whitelist_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Dispute System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_cases') THEN
    ALTER TABLE dispute_cases ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_cases_tenant') THEN
      ALTER TABLE dispute_cases ADD CONSTRAINT fk_dispute_cases_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_automation_rules') THEN
    ALTER TABLE dispute_automation_rules ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_automation_rules_tenant') THEN
      ALTER TABLE dispute_automation_rules ADD CONSTRAINT fk_dispute_automation_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence') THEN
    ALTER TABLE dispute_evidence ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_evidence_tenant') THEN
      ALTER TABLE dispute_evidence ADD CONSTRAINT fk_dispute_evidence_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_audit_log') THEN
    ALTER TABLE dispute_audit_log ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_audit_log_tenant') THEN
      ALTER TABLE dispute_audit_log ADD CONSTRAINT fk_dispute_audit_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Evidence System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_sources') THEN
    ALTER TABLE evidence_sources ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_evidence_sources_tenant') THEN
      ALTER TABLE evidence_sources ADD CONSTRAINT fk_evidence_sources_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_documents') THEN
    ALTER TABLE evidence_documents ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_evidence_documents_tenant') THEN
      ALTER TABLE evidence_documents ADD CONSTRAINT fk_evidence_documents_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_line_items') THEN
    ALTER TABLE evidence_line_items ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_evidence_line_items_tenant') THEN
      ALTER TABLE evidence_line_items ADD CONSTRAINT fk_evidence_line_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence_links') THEN
    ALTER TABLE dispute_evidence_links ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_dispute_evidence_links_tenant') THEN
      ALTER TABLE dispute_evidence_links ADD CONSTRAINT fk_dispute_evidence_links_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proof_packets') THEN
    ALTER TABLE proof_packets ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_proof_packets_tenant') THEN
      ALTER TABLE proof_packets ADD CONSTRAINT fk_proof_packets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'smart_prompts') THEN
    ALTER TABLE smart_prompts ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_smart_prompts_tenant') THEN
      ALTER TABLE smart_prompts ADD CONSTRAINT fk_smart_prompts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Recoveries
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recoveries') THEN
    ALTER TABLE recoveries ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_recoveries_tenant') THEN
      ALTER TABLE recoveries ADD CONSTRAINT fk_recoveries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- System Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events') THEN
    ALTER TABLE agent_events ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_agent_events_tenant') THEN
      ALTER TABLE agent_events ADD CONSTRAINT fk_agent_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    ALTER TABLE notifications ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_notifications_tenant') THEN
      ALTER TABLE notifications ADD CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_detection_triggers') THEN
    ALTER TABLE sync_detection_triggers ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_sync_detection_triggers_tenant') THEN
      ALTER TABLE sync_detection_triggers ADD CONSTRAINT fk_sync_detection_triggers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  -- Access Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens') THEN
    ALTER TABLE tokens ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_tokens_tenant') THEN
      ALTER TABLE tokens ADD CONSTRAINT fk_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_users_tenant') THEN
      ALTER TABLE users ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_users_last_active_tenant') THEN
      ALTER TABLE users ADD CONSTRAINT fk_users_last_active_tenant FOREIGN KEY (last_active_tenant_id) REFERENCES tenants(id);
    END IF;
  END IF;

  RAISE NOTICE 'Migration 048 completed - constraints added to all existing tables';
END $$;

-- Log constraint application
INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, event_type, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.tenant_constraints',
  'database',
  'migration',
  jsonb_build_object('migration', '048_add_tenant_constraints', 'timestamp', NOW()::TEXT)
);
