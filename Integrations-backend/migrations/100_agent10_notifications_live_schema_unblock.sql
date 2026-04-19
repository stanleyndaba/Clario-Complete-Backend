-- Migration: 100_agent10_notifications_live_schema_unblock
-- Purpose: align the live notifications table with hardened Agent 10 runtime expectations
-- without destructively rewriting existing notification history.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS delivery_state JSONB,
  ADD COLUMN IF NOT EXISTS last_delivery_error TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE notifications
SET
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, created_at, NOW())
WHERE created_at IS NULL
   OR updated_at IS NULL;

UPDATE notifications
SET dedupe_key = CONCAT_WS(
  ':',
  'legacy',
  COALESCE(NULLIF(BTRIM(type), ''), 'unknown'),
  COALESCE(
    NULLIF(BTRIM(payload->>'entity_id'), ''),
    NULLIF(BTRIM(payload->>'claim_id'), ''),
    NULLIF(BTRIM(payload->>'case_id'), ''),
    NULLIF(BTRIM(payload->>'dispute_case_id'), ''),
    NULLIF(BTRIM(payload->>'amazon_case_id'), ''),
    NULLIF(BTRIM(payload->>'sync_id'), ''),
    NULLIF(BTRIM(payload->>'document_id'), ''),
    NULLIF(BTRIM(payload->>'recovery_id'), ''),
    NULLIF(BTRIM(payload->>'invoice_id'), ''),
    'none'
  ),
  COALESCE(to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS'), 'missing_created_at'),
  id::text
)
WHERE dedupe_key IS NULL
   OR BTRIM(dedupe_key) = '';

ALTER TABLE notifications
  ALTER COLUMN delivery_state SET DEFAULT '{}'::jsonb;

UPDATE notifications
SET delivery_state = '{}'::jsonb
WHERE delivery_state IS NULL;

UPDATE notifications
SET delivery_state = jsonb_build_object(
  'legacy_backfill', true,
  'legacy_status', status,
  'derived_state', CASE
    WHEN status = 'delivered' THEN 'delivered'
    WHEN status = 'failed' THEN 'failed'
    ELSE 'unknown'
  END,
  'in_app_requested', channel IN ('in_app', 'both'),
  'email_requested', channel IN ('email', 'both'),
  'realtime_requested', channel IN ('in_app', 'both'),
  'in_app_success', CASE
    WHEN channel IN ('in_app', 'both') AND status IN ('pending', 'sent', 'delivered', 'read', 'partial')
      THEN true
    ELSE false
  END,
  'email_success', CASE
    WHEN channel IN ('email', 'both') AND status IN ('delivered', 'read', 'partial')
      THEN true
    ELSE false
  END,
  'realtime_success', CASE
    WHEN channel IN ('in_app', 'both') AND status IN ('pending', 'sent', 'delivered', 'read', 'partial')
      THEN true
    ELSE false
  END,
  'attempted_at', COALESCE(
    to_jsonb(delivered_at),
    to_jsonb(updated_at),
    to_jsonb(created_at)
  )
)
WHERE delivery_state = '{}'::jsonb;

ALTER TABLE notifications
  ALTER COLUMN delivery_state SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'notifications'
      AND constraint_name = 'notifications_status_check'
  ) THEN
    ALTER TABLE notifications DROP CONSTRAINT notifications_status_check;
  END IF;

  ALTER TABLE notifications
    ADD CONSTRAINT notifications_status_check
    CHECK (status IN (
      'pending',
      'sent',
      'delivered',
      'partial',
      'read',
      'failed',
      'expired'
    ));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'notifications'
      AND constraint_name = 'notifications_type_check'
  ) THEN
    ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
  END IF;

  ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'claim_detected',
      'evidence_found',
      'case_filed',
      'refund_approved',
      'funds_deposited',
      'integration_completed',
      'payment_processed',
      'sync_completed',
      'sync_started',
      'sync_failed',
      'discrepancy_found',
      'system_alert',
      'user_action_required',
      'amazon_challenge',
      'claim_denied',
      'claim_expiring',
      'learning_insight',
      'weekly_summary',
      'needs_evidence',
      'approved',
      'rejected',
      'paid',
      'product_update'
    ));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_tenant_user_dedupe_truth
  ON notifications(tenant_id, user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND BTRIM(dedupe_key) <> '';

COMMENT ON COLUMN notifications.dedupe_key IS 'Deterministic dedupe key for a single upstream notification event.';
COMMENT ON COLUMN notifications.delivery_state IS 'Per-channel delivery truth for Agent 10 notification delivery.';
COMMENT ON COLUMN notifications.last_delivery_error IS 'Last delivery failure reason for the notification.';
