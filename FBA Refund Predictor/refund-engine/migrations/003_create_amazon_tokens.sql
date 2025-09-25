-- Create table for storing encrypted Amazon OAuth refresh tokens per user
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS amazon_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE,
  refresh_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amazon_tokens_user_id ON amazon_tokens(user_id);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_amazon_tokens_updated_at ON amazon_tokens;
CREATE TRIGGER update_amazon_tokens_updated_at
  BEFORE UPDATE ON amazon_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

