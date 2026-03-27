-- Migration: 086_agent2_financial_truth
-- Purpose: Canonicalize financial event lineage and payout traceability for Agent 2 -> Agent 8

ALTER TABLE financial_events
  ADD COLUMN IF NOT EXISTS reference_id TEXT;

ALTER TABLE financial_events
  ADD COLUMN IF NOT EXISTS reference_type TEXT;

ALTER TABLE financial_events
  ADD COLUMN IF NOT EXISTS event_subtype TEXT;

ALTER TABLE financial_events
  ADD COLUMN IF NOT EXISTS settlement_id TEXT;

ALTER TABLE financial_events
  ADD COLUMN IF NOT EXISTS payout_batch_id TEXT;

ALTER TABLE financial_events
  ADD COLUMN IF NOT EXISTS is_payout_event BOOLEAN DEFAULT false;

DROP INDEX IF EXISTS financial_events_tenant_seller_event_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_events_tenant_seller_source_event
  ON financial_events(tenant_id, seller_id, source, amazon_event_id);

CREATE INDEX IF NOT EXISTS idx_financial_events_reference_id
  ON financial_events(reference_id);

CREATE INDEX IF NOT EXISTS idx_financial_events_settlement_id
  ON financial_events(settlement_id);

CREATE INDEX IF NOT EXISTS idx_financial_events_payout_batch_id
  ON financial_events(payout_batch_id);

CREATE INDEX IF NOT EXISTS idx_financial_events_is_payout_event
  ON financial_events(is_payout_event);
