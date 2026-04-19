-- Manual user broadcast email truth.
-- Adds admin-composed, manually sent user communication with durable delivery proof.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS manual_user_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  heading TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  cta_label TEXT,
  cta_url TEXT,
  audience_type TEXT NOT NULL DEFAULT 'test_emails'
    CHECK (audience_type IN ('test_emails', 'all_users', 'active_users')),
  audience_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sending', 'sent', 'failed', 'archived')),
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_user_broadcasts_status_created_at
  ON manual_user_broadcasts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS manual_user_broadcast_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES manual_user_broadcasts(id) ON DELETE CASCADE,
  user_id UUID,
  email TEXT NOT NULL,
  email_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  send_type TEXT NOT NULL DEFAULT 'final' CHECK (send_type IN ('test', 'final')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_user_broadcast_final_email
  ON manual_user_broadcast_deliveries(broadcast_id, email_key)
  WHERE send_type = 'final';

CREATE INDEX IF NOT EXISTS idx_manual_user_broadcast_deliveries_broadcast_status
  ON manual_user_broadcast_deliveries(broadcast_id, send_type, status);

CREATE OR REPLACE FUNCTION update_manual_user_broadcasts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_manual_user_broadcasts_updated_at ON manual_user_broadcasts;
CREATE TRIGGER trigger_update_manual_user_broadcasts_updated_at
  BEFORE UPDATE ON manual_user_broadcasts
  FOR EACH ROW
  EXECUTE FUNCTION update_manual_user_broadcasts_updated_at();

CREATE OR REPLACE FUNCTION update_manual_user_broadcast_deliveries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_manual_user_broadcast_deliveries_updated_at ON manual_user_broadcast_deliveries;
CREATE TRIGGER trigger_update_manual_user_broadcast_deliveries_updated_at
  BEFORE UPDATE ON manual_user_broadcast_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION update_manual_user_broadcast_deliveries_updated_at();

COMMENT ON TABLE manual_user_broadcasts IS
  'Admin-composed manual user broadcast email records. Draft saves do not notify users; send actions create delivery rows.';

COMMENT ON TABLE manual_user_broadcast_deliveries IS
  'Per-recipient email delivery truth for manual user broadcasts. Final sends are unique per broadcast and email.';
