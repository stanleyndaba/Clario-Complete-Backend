-- ========================================
-- Migration: 049_add_tenant_indexes.sql
-- Multi-Tenant SaaS: Comprehensive Indexing Strategy
-- ========================================

-- Primary tenant isolation indexes (CRITICAL for performance)

-- Core Data
CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tenant ON shipments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_returns_tenant ON returns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant ON settlements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tenant ON inventory(tenant_id);

-- Financial Events & Detection
CREATE INDEX IF NOT EXISTS idx_financial_events_tenant ON financial_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_detection_results_tenant ON detection_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_detection_queue_tenant ON detection_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_detection_thresholds_tenant ON detection_thresholds(tenant_id);
CREATE INDEX IF NOT EXISTS idx_detection_whitelist_tenant ON detection_whitelist(tenant_id);

-- Dispute System
CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant ON dispute_cases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispute_automation_rules_tenant ON dispute_automation_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_tenant ON dispute_evidence(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispute_audit_log_tenant ON dispute_audit_log(tenant_id);

-- Evidence System
CREATE INDEX IF NOT EXISTS idx_evidence_sources_tenant ON evidence_sources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant ON evidence_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evidence_line_items_tenant ON evidence_line_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_tenant ON dispute_evidence_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proof_packets_tenant ON proof_packets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_tenant ON smart_prompts(tenant_id);

-- Recoveries & System
CREATE INDEX IF NOT EXISTS idx_recoveries_tenant ON recoveries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_tenant ON agent_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_detection_triggers_tenant ON sync_detection_triggers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tokens_tenant ON tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- ========================================
-- Composite Indexes for Common Queries
-- ========================================

-- Dispute queries (by tenant + status, tenant + date)
CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_status ON dispute_cases(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_created ON dispute_cases(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_status_created ON dispute_cases(tenant_id, status, created_at DESC);

-- Detection queries
CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_status ON detection_results(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_created ON detection_results(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_severity ON detection_results(tenant_id, severity);

-- Evidence queries (by tenant + date, tenant + doc_type)
CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant_date ON evidence_documents(tenant_id, document_date DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_tenant_type ON evidence_documents(tenant_id, doc_type);

-- Recovery queries
CREATE INDEX IF NOT EXISTS idx_recoveries_tenant_status ON recoveries(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_recoveries_tenant_created ON recoveries(tenant_id, created_at DESC);

-- Notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_read ON notifications(tenant_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created ON notifications(tenant_id, created_at DESC);

-- ========================================
-- Multi-Account Support (Agency Use Case)
-- ========================================

-- For agencies managing multiple Amazon seller accounts per tenant
CREATE INDEX IF NOT EXISTS idx_tokens_tenant_seller ON tokens(tenant_id, seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_seller ON orders(tenant_id, seller_id);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_tenant_seller ON dispute_cases(tenant_id, seller_id);
CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_seller ON detection_results(tenant_id, seller_id);

-- ========================================
-- Soft Delete Aware Indexes
-- ========================================

-- Active records only (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_dispute_cases_active ON dispute_cases(tenant_id, status) 
  WHERE deleted_at IS NULL;
  
CREATE INDEX IF NOT EXISTS idx_recoveries_active ON recoveries(tenant_id, status) 
  WHERE deleted_at IS NULL;
  
CREATE INDEX IF NOT EXISTS idx_evidence_documents_active ON evidence_documents(tenant_id, document_date DESC) 
  WHERE deleted_at IS NULL;

-- ========================================
-- Tenant Lifecycle Queries
-- ========================================

CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(status) 
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_requiring_action ON tenants(status) 
  WHERE status IN ('suspended', 'read_only', 'trialing');

-- ========================================
-- Audit & Compliance
-- ========================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action ON audit_logs(tenant_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_resource ON audit_logs(tenant_id, resource_type, resource_id);

-- Optional tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_match_results') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_evidence_match_results_tenant ON evidence_match_results(tenant_id)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_snapshots') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sync_snapshots_tenant ON sync_snapshots(tenant_id)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'realtime_alerts') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_realtime_alerts_tenant ON realtime_alerts(tenant_id)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notes') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_notes_tenant ON user_notes(tenant_id)';
  END IF;
END $$;

-- Log index creation
INSERT INTO audit_logs (
  tenant_id,
  actor_type,
  action,
  resource_type,
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.tenant_indexes',
  'database',
  '{"migration": "049_add_tenant_indexes", "timestamp": "' || NOW()::TEXT || '"}'
);
