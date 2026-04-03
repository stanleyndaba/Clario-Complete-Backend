-- Migration: 098_agent10_notification_truth
-- Purpose: harden Agent 10 notification truth with tenant-scoped preferences, strict notification types, partial delivery state, and dedupe.

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  tenant_id UUID,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS delivery_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_delivery_error TEXT;

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
      'paid'
    ));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_tenant_user_dedupe_truth
  ON notifications(tenant_id, user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND BTRIM(dedupe_key) <> '';

ALTER TABLE user_notification_preferences
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE user_notification_preferences pref
SET tenant_id = COALESCE(
  pref.tenant_id,
  (
    SELECT tm.tenant_id
    FROM tenant_memberships tm
    WHERE tm.user_id::text = pref.user_id
      AND tm.is_active = true
    ORDER BY tm.created_at ASC NULLS LAST
    LIMIT 1
  ),
  (
    SELECT u.tenant_id
    FROM users u
    WHERE u.id::text = pref.user_id
    LIMIT 1
  )
)
WHERE pref.tenant_id IS NULL;

ALTER TABLE user_notification_preferences
  DROP CONSTRAINT IF EXISTS user_notification_preferences_user_id_key;

DROP INDEX IF EXISTS idx_user_notification_preferences_user_id;

INSERT INTO user_notification_preferences (user_id, tenant_id, preferences, created_at, updated_at)
SELECT
  pref.user_id,
  tm.tenant_id,
  pref.preferences,
  pref.created_at,
  pref.updated_at
FROM user_notification_preferences pref
JOIN tenant_memberships tm
  ON tm.user_id::text = pref.user_id
 AND tm.is_active = true
WHERE pref.tenant_id IS NOT NULL
  AND tm.tenant_id <> pref.tenant_id
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
  unresolved_count INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = default_tenant_id) THEN
    RAISE EXCEPTION 'Default tenant % does not exist. Run migrations 046/047 first.', default_tenant_id;
  END IF;

  UPDATE user_notification_preferences
  SET tenant_id = default_tenant_id
  WHERE tenant_id IS NULL;

  SELECT COUNT(*) INTO unresolved_count
  FROM user_notification_preferences
  WHERE tenant_id IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION 'Notification preference migration failed: % rows still missing tenant_id', unresolved_count;
  END IF;
END $$;

ALTER TABLE user_notification_preferences
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_notification_preferences_user_tenant
  ON user_notification_preferences(user_id, tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_tenant_user
  ON user_notification_preferences(tenant_id, user_id);

ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN notifications.dedupe_key IS 'Deterministic event-level dedupe key. Same upstream event must not create multiple notifications.';
COMMENT ON COLUMN notifications.delivery_state IS 'Per-channel delivery truth for in-app, realtime, and email.';
COMMENT ON COLUMN notifications.last_delivery_error IS 'Last delivery failure reason when a notification could not be fully delivered.';
COMMENT ON COLUMN user_notification_preferences.tenant_id IS 'Tenant-scoped notification preference ownership. Preferences are specific to a user within a workspace.';
