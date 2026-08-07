-- Migration: Track provider credential health without exposing stored secrets
-- Purpose: allow malformed/undecryptable credentials to become reconnect-required
-- instead of repeatedly failing workers or appearing connected.

ALTER TABLE tokens
  ADD COLUMN IF NOT EXISTS credential_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS credential_error_code TEXT,
  ADD COLUMN IF NOT EXISTS credential_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credential_reconnect_required_at TIMESTAMPTZ;

ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_credential_status_check;
ALTER TABLE tokens
  ADD CONSTRAINT tokens_credential_status_check
  CHECK (credential_status IN ('active', 'reconnect_required'));

CREATE INDEX IF NOT EXISTS idx_tokens_credential_status
  ON tokens(provider, credential_status)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN tokens.credential_status IS 'active or reconnect_required; never stores plaintext credentials';
COMMENT ON COLUMN tokens.credential_error_code IS 'sanitized reconnect reason code such as invalid_iv_length or decrypt_failed';
