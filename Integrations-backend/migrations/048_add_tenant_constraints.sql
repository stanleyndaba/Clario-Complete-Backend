-- ========================================
-- Migration: 048_add_tenant_constraints.sql
-- Multi-Tenant SaaS: Add NOT NULL + Foreign Key Constraints
-- ========================================

-- After backfill, enforce tenant_id is required

-- Core Data Tables
ALTER TABLE orders ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE orders ADD CONSTRAINT fk_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE shipments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE shipments ADD CONSTRAINT fk_shipments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE returns ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE returns ADD CONSTRAINT fk_returns_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE settlements ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE settlements ADD CONSTRAINT fk_settlements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE inventory ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE inventory ADD CONSTRAINT fk_inventory_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Financial Events & Detection
ALTER TABLE financial_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE financial_events ADD CONSTRAINT fk_financial_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE detection_results ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE detection_results ADD CONSTRAINT fk_detection_results_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE detection_queue ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE detection_queue ADD CONSTRAINT fk_detection_queue_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE detection_thresholds ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE detection_thresholds ADD CONSTRAINT fk_detection_thresholds_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE detection_whitelist ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE detection_whitelist ADD CONSTRAINT fk_detection_whitelist_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Dispute System
ALTER TABLE dispute_cases ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dispute_cases ADD CONSTRAINT fk_dispute_cases_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE dispute_automation_rules ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dispute_automation_rules ADD CONSTRAINT fk_dispute_automation_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE dispute_evidence ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dispute_evidence ADD CONSTRAINT fk_dispute_evidence_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE dispute_audit_log ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dispute_audit_log ADD CONSTRAINT fk_dispute_audit_log_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Evidence System
ALTER TABLE evidence_sources ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE evidence_sources ADD CONSTRAINT fk_evidence_sources_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE evidence_documents ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE evidence_documents ADD CONSTRAINT fk_evidence_documents_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE evidence_line_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE evidence_line_items ADD CONSTRAINT fk_evidence_line_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE dispute_evidence_links ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dispute_evidence_links ADD CONSTRAINT fk_dispute_evidence_links_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE proof_packets ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE proof_packets ADD CONSTRAINT fk_proof_packets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE smart_prompts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE smart_prompts ADD CONSTRAINT fk_smart_prompts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Recoveries
ALTER TABLE recoveries ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE recoveries ADD CONSTRAINT fk_recoveries_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- System Tables
ALTER TABLE agent_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE agent_events ADD CONSTRAINT fk_agent_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE notifications ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE sync_detection_triggers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sync_detection_triggers ADD CONSTRAINT fk_sync_detection_triggers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Access Tables
ALTER TABLE tokens ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE tokens ADD CONSTRAINT fk_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Add FK for last_active_tenant_id
ALTER TABLE users ADD CONSTRAINT fk_users_last_active_tenant 
  FOREIGN KEY (last_active_tenant_id) REFERENCES tenants(id);

-- Optional tables - apply constraints if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_match_results') THEN
    EXECUTE 'ALTER TABLE evidence_match_results ALTER COLUMN tenant_id SET NOT NULL';
    EXECUTE 'ALTER TABLE evidence_match_results ADD CONSTRAINT fk_evidence_match_results_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'parser_jobs') THEN
    EXECUTE 'ALTER TABLE parser_jobs ALTER COLUMN tenant_id SET NOT NULL';
    EXECUTE 'ALTER TABLE parser_jobs ADD CONSTRAINT fk_parser_jobs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_insights') THEN
    EXECUTE 'ALTER TABLE learning_insights ALTER COLUMN tenant_id SET NOT NULL';
    EXECUTE 'ALTER TABLE learning_insights ADD CONSTRAINT fk_learning_insights_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_snapshots') THEN
    EXECUTE 'ALTER TABLE sync_snapshots ALTER COLUMN tenant_id SET NOT NULL';
    EXECUTE 'ALTER TABLE sync_snapshots ADD CONSTRAINT fk_sync_snapshots_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'realtime_alerts') THEN
    EXECUTE 'ALTER TABLE realtime_alerts ALTER COLUMN tenant_id SET NOT NULL';
    EXECUTE 'ALTER TABLE realtime_alerts ADD CONSTRAINT fk_realtime_alerts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notes') THEN
    EXECUTE 'ALTER TABLE user_notes ALTER COLUMN tenant_id SET NOT NULL';
    EXECUTE 'ALTER TABLE user_notes ADD CONSTRAINT fk_user_notes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)';
  END IF;
END $$;

-- Log constraint application
INSERT INTO audit_logs (
  tenant_id,
  actor_type,
  action,
  resource_type,
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.tenant_constraints',
  'database',
  '{"migration": "048_add_tenant_constraints", "timestamp": "' || NOW()::TEXT || '"}'
);
