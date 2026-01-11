-- ========================================
-- Migration: 049_add_tenant_indexes.sql
-- Multi-Tenant SaaS: Comprehensive Indexing Strategy
-- SAFE VERSION: Uses IF EXISTS checks for all tables
-- ========================================

DO $$
BEGIN
  -- Core Data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
    CREATE INDEX IF NOT EXISTS idx_shipments_tenant ON shipments(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'returns') THEN
    CREATE INDEX IF NOT EXISTS idx_returns_tenant ON returns(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    CREATE INDEX IF NOT EXISTS idx_settlements_tenant ON settlements(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory(tenant_id);
  END IF;

  -- Financial Events & Detection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_events') THEN
    CREATE INDEX IF NOT EXISTS idx_financial_events_tenant ON financial_events(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_results') THEN
    CREATE INDEX IF NOT EXISTS idx_detection_results_tenant ON detection_results(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_status ON detection_results(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_created ON detection_results(tenant_id, created_at DESC);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_queue') THEN
    CREATE INDEX IF NOT EXISTS idx_detection_queue_tenant ON detection_queue(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_thresholds') THEN
    CREATE INDEX IF NOT EXISTS idx_detection_thresholds_tenant ON detection_thresholds(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_whitelist') THEN
    CREATE INDEX IF NOT EXISTS idx_detection_whitelist_tenant ON detection_whitelist(tenant_id);
  END IF;

  -- Dispute System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_cases') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant ON dispute_cases(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_status ON dispute_cases(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_created ON dispute_cases(tenant_id, created_at DESC);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_automation_rules') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_automation_rules_tenant ON dispute_automation_rules(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_evidence_tenant ON dispute_evidence(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_audit_log') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_audit_log_tenant ON dispute_audit_log(tenant_id);
  END IF;

  -- Evidence System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_sources') THEN
    CREATE INDEX IF NOT EXISTS idx_evidence_sources_tenant ON evidence_sources(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_documents') THEN
    CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant ON evidence_documents(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant_date ON evidence_documents(tenant_id, document_date DESC);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_line_items') THEN
    CREATE INDEX IF NOT EXISTS idx_evidence_line_items_tenant ON evidence_line_items(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence_links') THEN
    CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_tenant ON dispute_evidence_links(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proof_packets') THEN
    CREATE INDEX IF NOT EXISTS idx_proof_packets_tenant ON proof_packets(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'smart_prompts') THEN
    CREATE INDEX IF NOT EXISTS idx_smart_prompts_tenant ON smart_prompts(tenant_id);
  END IF;

  -- Recoveries & System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recoveries') THEN
    CREATE INDEX IF NOT EXISTS idx_recoveries_tenant ON recoveries(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_recoveries_tenant_status ON recoveries(tenant_id, status);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events') THEN
    CREATE INDEX IF NOT EXISTS idx_agent_events_tenant ON agent_events(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_detection_triggers') THEN
    CREATE INDEX IF NOT EXISTS idx_sync_detection_triggers_tenant ON sync_detection_triggers(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens') THEN
    CREATE INDEX IF NOT EXISTS idx_tokens_tenant ON tokens(tenant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
  END IF;

  -- Audit logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action ON audit_logs(tenant_id, action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_resource ON audit_logs(tenant_id, resource_type, resource_id);
  END IF;

  -- Tenant lifecycle
  CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(status) WHERE status = 'active' AND deleted_at IS NULL;

  RAISE NOTICE 'Migration 049 completed - indexes created for all existing tables';
END $$;

-- Log index creation
INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, event_type, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.tenant_indexes',
  'database',
  'migration',
  jsonb_build_object('migration', '049_add_tenant_indexes', 'timestamp', NOW()::TEXT)
);
