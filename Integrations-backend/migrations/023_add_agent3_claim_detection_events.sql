-- Migration: Add Agent 3 (Claim Detection) to agent_events table
-- This allows Agent 3 to log events for continuous learning

-- Update agent_events table to include 'claim_detection' as a valid agent type
ALTER TABLE agent_events 
  DROP CONSTRAINT IF EXISTS agent_events_agent_check;

ALTER TABLE agent_events 
  ADD CONSTRAINT agent_events_agent_check 
  CHECK (agent IN (
    'evidence_ingestion',
    'document_parsing',
    'evidence_matching',
    'refund_filing',
    'recoveries',
    'billing',
    'data_sync',        -- Agent 2: Continuous Data Sync
    'claim_detection'  -- Agent 3: Claim Detection
  ));

-- Add comment
COMMENT ON COLUMN agent_events.agent IS 'Agent type: evidence_ingestion, document_parsing, evidence_matching, refund_filing, recoveries, billing, data_sync, or claim_detection';

