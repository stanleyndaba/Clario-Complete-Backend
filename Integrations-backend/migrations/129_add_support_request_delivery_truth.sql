-- ========================================
-- Migration: 129_add_support_request_delivery_truth.sql
-- Purpose: make authenticated Help requests durable and traceable independently
--          from internal/seller email provider outcomes.
-- ========================================

ALTER TABLE support_requests
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS internal_email_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS internal_email_provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS internal_email_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_email_last_error TEXT,
  ADD COLUMN IF NOT EXISTS internal_email_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS internal_email_last_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledgement_email_status TEXT NOT NULL DEFAULT 'not_available',
  ADD COLUMN IF NOT EXISTS acknowledgement_email_provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS acknowledgement_email_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acknowledgement_email_last_error TEXT,
  ADD COLUMN IF NOT EXISTS acknowledgement_email_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledgement_email_last_event_at TIMESTAMPTZ;

ALTER TABLE support_requests
  DROP CONSTRAINT IF EXISTS support_requests_internal_email_status_check;

ALTER TABLE support_requests
  ADD CONSTRAINT support_requests_internal_email_status_check
  CHECK (internal_email_status IN ('pending', 'accepted', 'delivered', 'failed', 'bounced', 'complained'));

ALTER TABLE support_requests
  DROP CONSTRAINT IF EXISTS support_requests_acknowledgement_email_status_check;

ALTER TABLE support_requests
  ADD CONSTRAINT support_requests_acknowledgement_email_status_check
  CHECK (acknowledgement_email_status IN ('not_available', 'pending', 'accepted', 'delivered', 'failed', 'bounced', 'complained'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_requests_tenant_user_idempotency
  ON support_requests (tenant_id, user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_support_requests_internal_email_provider_message_id
  ON support_requests (internal_email_provider_message_id)
  WHERE internal_email_provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_requests_ack_email_provider_message_id
  ON support_requests (acknowledgement_email_provider_message_id)
  WHERE acknowledgement_email_provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_requests_delivery_recovery
  ON support_requests (tenant_id, internal_email_status, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN support_requests.idempotency_key IS
  'Caller-generated key scoped to tenant and authenticated user; prevents duplicate support records after retry.';
COMMENT ON COLUMN support_requests.internal_email_status IS
  'Truthful internal support-notification state: persisted separately from the seller request.';
COMMENT ON COLUMN support_requests.acknowledgement_email_status IS
  'Truthful seller acknowledgement state; not_available when no verified reply email exists.';
