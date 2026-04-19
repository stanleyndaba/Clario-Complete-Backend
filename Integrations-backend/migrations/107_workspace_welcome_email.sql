-- Workspace welcome email truth.
-- Sends a one-time setup email after signup and workspace creation complete,
-- without blocking onboarding or spamming future sessions.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS welcome_email_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_email_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_users_welcome_email_sent_at
  ON users(welcome_email_sent_at);

COMMENT ON COLUMN users.welcome_email_attempted_at IS
  'Last attempt to send the one-time welcome email after signup and workspace creation.';

COMMENT ON COLUMN users.welcome_email_sent_at IS
  'Timestamp when the one-time welcome email was successfully sent.';

COMMENT ON COLUMN users.welcome_email_last_error IS
  'Last non-blocking welcome email delivery error, if delivery failed.';
