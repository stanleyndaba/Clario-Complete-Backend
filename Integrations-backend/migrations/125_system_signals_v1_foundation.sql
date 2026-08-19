-- Migration 125: System Signals V1 foundation
-- Extends the existing seller-facing `notifications` table. It deliberately does
-- not create a second inbox and keeps canonical metadata nullable for legacy rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS system_signal_id UUID,
  ADD COLUMN IF NOT EXISTS signal_event_type TEXT,
  ADD COLUMN IF NOT EXISTS signal_event_version INTEGER,
  ADD COLUMN IF NOT EXISTS signal_domain TEXT,
  ADD COLUMN IF NOT EXISTS signal_severity TEXT,
  ADD COLUMN IF NOT EXISTS signal_sensitivity TEXT,
  ADD COLUMN IF NOT EXISTS signal_provider_state TEXT,
  ADD COLUMN IF NOT EXISTS signal_occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signal_correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS signal_causation_id TEXT,
  ADD COLUMN IF NOT EXISTS signal_object_type TEXT,
  ADD COLUMN IF NOT EXISTS signal_object_id TEXT,
  ADD COLUMN IF NOT EXISTS signal_action_type TEXT,
  ADD COLUMN IF NOT EXISTS signal_action_route JSONB,
  ADD COLUMN IF NOT EXISTS signal_delivery_policy TEXT,
  ADD COLUMN IF NOT EXISTS signal_state TEXT,
  ADD COLUMN IF NOT EXISTS seller_state TEXT,
  ADD COLUMN IF NOT EXISTS action_state TEXT,
  ADD COLUMN IF NOT EXISTS detailed_body TEXT,
  ADD COLUMN IF NOT EXISTS external_title TEXT,
  ADD COLUMN IF NOT EXISTS external_body TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_reason TEXT,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- Canonical rows must carry complete, restricted classifications. Legacy rows are
-- intentionally permitted to remain null during the transition.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_system_signal_severity_check,
  DROP CONSTRAINT IF EXISTS notifications_system_signal_sensitivity_check,
  DROP CONSTRAINT IF EXISTS notifications_system_signal_provider_state_check,
  DROP CONSTRAINT IF EXISTS notifications_system_signal_state_check,
  DROP CONSTRAINT IF EXISTS notifications_seller_state_check,
  DROP CONSTRAINT IF EXISTS notifications_action_state_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_system_signal_severity_check
    CHECK (signal_severity IS NULL OR signal_severity IN ('critical', 'action_required', 'informational')),
  ADD CONSTRAINT notifications_system_signal_sensitivity_check
    CHECK (signal_sensitivity IS NULL OR signal_sensitivity IN ('operational_private', 'financial_sensitive', 'security_sensitive')),
  ADD CONSTRAINT notifications_system_signal_provider_state_check
    CHECK (signal_provider_state IS NULL OR signal_provider_state IN ('provider_outage', 'seller_auth_failure', 'business_outcome', 'none')),
  ADD CONSTRAINT notifications_system_signal_state_check
    CHECK (signal_state IS NULL OR signal_state IN ('open', 'resolved', 'expired', 'superseded', 'cancelled')),
  ADD CONSTRAINT notifications_seller_state_check
    CHECK (seller_state IS NULL OR seller_state IN ('unseen', 'seen', 'read', 'acknowledged')),
  ADD CONSTRAINT notifications_action_state_check
    CHECK (action_state IS NULL OR action_state IN ('none', 'pending', 'completed', 'no_longer_needed', 'expired'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_system_signal_id
  ON notifications(system_signal_id)
  WHERE system_signal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_system_signal_lookup
  ON notifications(tenant_id, user_id, signal_state, created_at DESC)
  WHERE system_signal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_system_signal_object
  ON notifications(tenant_id, signal_object_type, signal_object_id, signal_state)
  WHERE system_signal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_system_signal_event
  ON notifications(tenant_id, signal_event_type, signal_state, created_at DESC)
  WHERE system_signal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_signal_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  signal_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  recipient_user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  attempted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  provider_confirmed_at TIMESTAMPTZ,
  client_received_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  last_error TEXT,
  provider_message_id TEXT,
  provider_event_id TEXT,
  suppressed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_signal_deliveries_channel_check
    CHECK (channel IN ('in_app', 'realtime', 'email')),
  CONSTRAINT notification_signal_deliveries_status_check
    CHECK (status IN ('queued', 'persisted', 'attempted', 'accepted', 'provider_confirmed', 'client_received', 'failed_transient', 'failed_permanent', 'suppressed', 'cancelled')),
  CONSTRAINT uq_notification_signal_delivery_channel UNIQUE (notification_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_signal_deliveries_tenant_signal
  ON notification_signal_deliveries(tenant_id, signal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_signal_deliveries_recipient
  ON notification_signal_deliveries(tenant_id, recipient_user_id, status, created_at DESC);

COMMENT ON COLUMN notifications.system_signal_id IS 'Canonical identity for a System Signals V1 notification. Legacy rows remain null.';
COMMENT ON COLUMN notifications.signal_event_type IS 'Stable System Signal event type, distinct from legacy notification type.';
COMMENT ON COLUMN notifications.signal_action_route IS 'Validated semantic action descriptor; frontend resolves it through a controlled route registry.';
COMMENT ON TABLE notification_signal_deliveries IS 'Minimal per-channel delivery lineage for canonical System Signals V1 notifications.';
COMMENT ON COLUMN notification_signal_deliveries.client_received_at IS 'Authenticated client receipt only; it is not seller seen/read/action truth.';
