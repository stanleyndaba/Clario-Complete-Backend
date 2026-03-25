-- Migration: 083_financial_finality_dead_letter
-- Purpose: Explicit terminal retry exhaustion states for financial work items

ALTER TABLE recovery_work_items
  DROP CONSTRAINT IF EXISTS recovery_work_items_status_check;

ALTER TABLE recovery_work_items
  ADD CONSTRAINT recovery_work_items_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'quarantined', 'failed_retry_exhausted'));

ALTER TABLE billing_work_items
  DROP CONSTRAINT IF EXISTS billing_work_items_status_check;

ALTER TABLE billing_work_items
  ADD CONSTRAINT billing_work_items_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'quarantined', 'failed_retry_exhausted'));
