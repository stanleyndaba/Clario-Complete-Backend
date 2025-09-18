-- Track third-party integration token status per user
CREATE TABLE IF NOT EXISTS integration_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(64) NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('amazon','gmail','stripe')),
  status TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_integration_status_user_provider ON integration_status(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_integration_status_updated_at ON integration_status(updated_at DESC);







