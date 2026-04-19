-- Email delivery tracking truth.
-- Stores Resend provider IDs and webhook events so accepted/sent/bounced/complained
-- states are inspectable instead of inferred from inbox placement.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS welcome_email_provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS welcome_email_delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS welcome_email_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_email_bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_email_complained_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_email_last_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_welcome_email_provider_message_id
  ON users(welcome_email_provider_message_id);

ALTER TABLE manual_user_broadcast_deliveries
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS complained_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_manual_user_broadcast_deliveries_provider_message_id
  ON manual_user_broadcast_deliveries(provider_message_id);

CREATE TABLE IF NOT EXISTS email_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_event_id TEXT NOT NULL,
  provider_message_id TEXT,
  event_type TEXT NOT NULL,
  recipient_email TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_delivery_events_provider_event
  ON email_delivery_events(provider, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_email_delivery_events_provider_message_id
  ON email_delivery_events(provider_message_id, created_at DESC);

COMMENT ON COLUMN users.welcome_email_provider_message_id IS
  'Resend provider email ID for the workspace welcome email, when available.';

COMMENT ON TABLE email_delivery_events IS
  'Raw provider webhook delivery events for operational email traceability.';
