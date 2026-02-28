-- ========================================
-- Migration: 061_fix_agent_events_constraint.sql
-- Expand agent_events_agent_check to support all 11 agents
-- ========================================

DO $$
BEGIN
    ALTER TABLE agent_events 
    DROP CONSTRAINT IF EXISTS agent_events_agent_check;

    ALTER TABLE agent_events 
    ADD CONSTRAINT agent_events_agent_check 
    CHECK (agent IN (
        'zero',
        'data_sync',
        'detection',
        'evidence',
        'parsing',
        'matching',
        'filing',
        'recoveries',
        'billing',
        'notifications',
        'learning',
        -- Include legacy names just in case
        'evidence_ingestion',
        'document_parsing',
        'evidence_matching',
        'refund_filing',
        'claim_detection'
    ));
END $$;

-- Log migration
INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, event_type, metadata)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'migration.agent_events_fix',
  'database',
  'migration',
  jsonb_build_object('migration', '061_fix_agent_events_constraint', 'timestamp', NOW()::TEXT)
);
