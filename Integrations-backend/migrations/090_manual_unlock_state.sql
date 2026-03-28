-- Migration: 090_manual_unlock_state
-- Purpose: Persist manual payment unlock state for filing access

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS billing_status TEXT,
  ADD COLUMN IF NOT EXISTS billing_unlocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_source TEXT,
  ADD COLUMN IF NOT EXISTS billing_unlock_confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_billing_status
  ON users(billing_status);

COMMENT ON COLUMN users.billing_status IS 'User-level filing payment state. unlocked indicates filing access can execute.';
COMMENT ON COLUMN users.billing_unlocked_at IS 'Timestamp when filing access was manually or automatically unlocked.';
COMMENT ON COLUMN users.billing_source IS 'Unlock source such as paypal_webhook or yoco_manual.';
COMMENT ON COLUMN users.billing_unlock_confirmed_by IS 'User who confirmed the payment unlock action.';
