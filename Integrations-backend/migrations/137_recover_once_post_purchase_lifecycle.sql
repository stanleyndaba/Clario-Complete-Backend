-- Migration 137: Persist the Recover Once post-purchase lifecycle.
-- Recover Once remains a one-time engagement and is not a subscription.
ALTER TABLE recover_once_engagements
  DROP CONSTRAINT IF EXISTS recover_once_engagements_status_check;

ALTER TABLE recover_once_engagements
  ADD CONSTRAINT recover_once_engagements_status_check
  CHECK (status IN (
    'active',
    'preparing',
    'ready_for_review',
    'awaiting_seller_approval',
    'in_progress',
    'completed',
    'cancelled',
    'exception'
  ));

ALTER TABLE recover_once_engagements
  ADD COLUMN IF NOT EXISTS preparation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_for_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seller_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exception_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_customer_notified_at TIMESTAMPTZ;

UPDATE recover_once_engagements
SET status = 'preparing',
    preparation_started_at = COALESCE(preparation_started_at, started_at),
    updated_at = NOW()
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_recover_once_engagements_status
  ON recover_once_engagements(tenant_id, status, updated_at DESC);
