-- Product updates publish + broadcast truth.
-- Turns the Latest Changes page into a canonical published record surface and
-- adds durable delivery/idempotency proof for update broadcasts.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS product_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT,
  tag TEXT,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_text TEXT,
  cta_href TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  audience_scope TEXT NOT NULL DEFAULT 'all_users' CHECK (audience_scope IN ('all_users')),
  notify_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMPTZ,
  broadcasted_at TIMESTAMPTZ,
  created_by TEXT,
  published_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_updates_status_published_at
  ON product_updates(status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_updates_created_at
  ON product_updates(created_at DESC);

CREATE TABLE IF NOT EXISTS product_update_broadcast_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_update_id UUID NOT NULL REFERENCES product_updates(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  target_count INTEGER NOT NULL DEFAULT 0,
  in_app_sent_count INTEGER NOT NULL DEFAULT 0,
  email_sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_update_broadcast_jobs_update
  ON product_update_broadcast_jobs(product_update_id);

CREATE TABLE IF NOT EXISTS product_update_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_update_id UUID NOT NULL REFERENCES product_updates(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'skipped', 'failed')),
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_update_delivery_channel
  ON product_update_deliveries(product_update_id, user_id, channel);

CREATE INDEX IF NOT EXISTS idx_product_update_deliveries_update_status
  ON product_update_deliveries(product_update_id, status);

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

CREATE OR REPLACE FUNCTION update_product_updates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_product_updates_updated_at ON product_updates;
CREATE TRIGGER trigger_update_product_updates_updated_at
  BEFORE UPDATE ON product_updates
  FOR EACH ROW
  EXECUTE FUNCTION update_product_updates_updated_at();

CREATE OR REPLACE FUNCTION update_product_update_broadcast_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_product_update_broadcast_jobs_updated_at ON product_update_broadcast_jobs;
CREATE TRIGGER trigger_update_product_update_broadcast_jobs_updated_at
  BEFORE UPDATE ON product_update_broadcast_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_product_update_broadcast_jobs_updated_at();

CREATE OR REPLACE FUNCTION update_product_update_deliveries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_product_update_deliveries_updated_at ON product_update_deliveries;
CREATE TRIGGER trigger_update_product_update_deliveries_updated_at
  BEFORE UPDATE ON product_update_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION update_product_update_deliveries_updated_at();

COMMENT ON TABLE product_updates IS
  'Canonical product update records. Draft saves do not notify users; publish triggers broadcast.';

COMMENT ON TABLE product_update_broadcast_jobs IS
  'Durable product update broadcast job truth. One job per published update.';

COMMENT ON TABLE product_update_deliveries IS
  'Per-user, per-tenant, per-channel delivery truth for product update broadcasts.';
