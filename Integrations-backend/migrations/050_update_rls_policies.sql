-- ========================================
-- Migration: 050_update_rls_policies.sql
-- Multi-Tenant SaaS: Update RLS for Tenant Isolation
-- ========================================

-- New RLS pattern: Filter by tenant membership
-- Users can only see data from tenants they belong to

-- Helper function to get user's active tenant IDs
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS SETOF UUID AS $$
  SELECT tenant_id 
  FROM tenant_memberships 
  WHERE user_id = auth.uid() 
    AND is_active = TRUE 
    AND deleted_at IS NULL;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ========================================
-- Core Data Tables
-- ========================================

-- Financial Events
DROP POLICY IF EXISTS "Users can view their own financial events" ON financial_events;
CREATE POLICY "Tenant isolation for financial_events" ON financial_events
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Detection Results
DROP POLICY IF EXISTS "Users can view their own detection results" ON detection_results;
DROP POLICY IF EXISTS "Users can insert their own detection results" ON detection_results;
DROP POLICY IF EXISTS "Users can update their own detection results" ON detection_results;
CREATE POLICY "Tenant isolation for detection_results" ON detection_results
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Detection Queue
DROP POLICY IF EXISTS "Users can view their own detection queue items" ON detection_queue;
DROP POLICY IF EXISTS "Users can insert their own detection queue items" ON detection_queue;
DROP POLICY IF EXISTS "Users can update their own detection queue items" ON detection_queue;
CREATE POLICY "Tenant isolation for detection_queue" ON detection_queue
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Dispute System
-- ========================================

DROP POLICY IF EXISTS "Users can view their own dispute cases" ON dispute_cases;
DROP POLICY IF EXISTS "Users can insert their own dispute cases" ON dispute_cases;
DROP POLICY IF EXISTS "Users can update their own dispute cases" ON dispute_cases;
CREATE POLICY "Tenant isolation for dispute_cases" ON dispute_cases
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Users can view their own automation rules" ON dispute_automation_rules;
DROP POLICY IF EXISTS "Users can insert their own automation rules" ON dispute_automation_rules;
DROP POLICY IF EXISTS "Users can update their own automation rules" ON dispute_automation_rules;
CREATE POLICY "Tenant isolation for dispute_automation_rules" ON dispute_automation_rules
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Dispute Evidence (now has direct tenant_id)
DROP POLICY IF EXISTS "Users can view evidence for their own cases" ON dispute_evidence;
DROP POLICY IF EXISTS "Users can insert evidence for their own cases" ON dispute_evidence;
CREATE POLICY "Tenant isolation for dispute_evidence" ON dispute_evidence
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Dispute Audit Log
DROP POLICY IF EXISTS "Users can view audit logs for their own cases" ON dispute_audit_log;
CREATE POLICY "Tenant isolation for dispute_audit_log" ON dispute_audit_log
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Evidence System
-- ========================================

DROP POLICY IF EXISTS evidence_sources_owner_select ON evidence_sources;
DROP POLICY IF EXISTS evidence_sources_owner_insert ON evidence_sources;
DROP POLICY IF EXISTS evidence_sources_owner_update ON evidence_sources;
CREATE POLICY "Tenant isolation for evidence_sources" ON evidence_sources
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS evidence_documents_owner_select ON evidence_documents;
DROP POLICY IF EXISTS evidence_documents_owner_insert ON evidence_documents;
DROP POLICY IF EXISTS evidence_documents_owner_update ON evidence_documents;
CREATE POLICY "Tenant isolation for evidence_documents" ON evidence_documents
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS evidence_line_items_owner_select ON evidence_line_items;
DROP POLICY IF EXISTS evidence_line_items_owner_insert ON evidence_line_items;
DROP POLICY IF EXISTS evidence_line_items_owner_update ON evidence_line_items;
CREATE POLICY "Tenant isolation for evidence_line_items" ON evidence_line_items
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS dispute_evidence_links_dispute_scope ON dispute_evidence_links;
DROP POLICY IF EXISTS dispute_evidence_links_insert_scope ON dispute_evidence_links;
CREATE POLICY "Tenant isolation for dispute_evidence_links" ON dispute_evidence_links
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS proof_packets_owner_select ON proof_packets;
DROP POLICY IF EXISTS proof_packets_owner_insert ON proof_packets;
CREATE POLICY "Tenant isolation for proof_packets" ON proof_packets
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS smart_prompts_owner_select ON smart_prompts;
DROP POLICY IF EXISTS smart_prompts_owner_insert ON smart_prompts;
DROP POLICY IF EXISTS smart_prompts_owner_update ON smart_prompts;
CREATE POLICY "Tenant isolation for smart_prompts" ON smart_prompts
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Additional Tables
-- ========================================

-- Detection Thresholds
DROP POLICY IF EXISTS "Users can view their own thresholds" ON detection_thresholds;
DROP POLICY IF EXISTS "Users can insert their own thresholds" ON detection_thresholds;
DROP POLICY IF EXISTS "Users can update their own thresholds" ON detection_thresholds;
CREATE POLICY "Tenant isolation for detection_thresholds" ON detection_thresholds
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Detection Whitelist
DROP POLICY IF EXISTS "Users can view their own whitelist" ON detection_whitelist;
DROP POLICY IF EXISTS "Users can insert their own whitelist" ON detection_whitelist;
DROP POLICY IF EXISTS "Users can update their own whitelist" ON detection_whitelist;
CREATE POLICY "Tenant isolation for detection_whitelist" ON detection_whitelist
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Sync Detection Triggers
DROP POLICY IF EXISTS "Users can view their own sync triggers" ON sync_detection_triggers;
DROP POLICY IF EXISTS "Users can insert their own sync triggers" ON sync_detection_triggers;
DROP POLICY IF EXISTS "Users can update their own sync triggers" ON sync_detection_triggers;
CREATE POLICY "Tenant isolation for sync_detection_triggers" ON sync_detection_triggers
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Evidence Ingestion Errors
DROP POLICY IF EXISTS evidence_ingestion_errors_owner_select ON evidence_ingestion_errors;
CREATE POLICY "Tenant isolation for evidence_ingestion_errors" ON evidence_ingestion_errors
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Tokens Table (Critical for OAuth)
-- ========================================

-- RLS for tokens - users can only see tokens for their tenants
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for tokens" ON tokens;
CREATE POLICY "Tenant isolation for tokens" ON tokens
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Notifications
-- ========================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for notifications" ON notifications;
CREATE POLICY "Tenant isolation for notifications" ON notifications
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ========================================
-- Recoveries
-- ========================================

ALTER TABLE recoveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant isolation for recoveries" ON recoveries;
CREATE POLICY "Tenant isolation for recoveries" ON recoveries
  FOR ALL USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Log RLS update
INSERT INTO audit_logs (
  tenant_id,
  actor_type,
  action,
  resource_type,
  event_type,
  metadata
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.rls_update',
  'database',
  'migration',
  jsonb_build_object('migration', '050_update_rls_policies', 'timestamp', NOW()::TEXT)
);
