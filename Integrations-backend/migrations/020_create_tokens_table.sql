-- Migration: Create tokens table for OAuth token storage
-- This table stores encrypted OAuth tokens with IV+data format for proper encryption handling
-- Migration: 020_create_tokens_table.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tokens table with IV+data columns for encrypted token storage
CREATE TABLE IF NOT EXISTS tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider varchar(64) NOT NULL CHECK (provider IN ('amazon', 'gmail', 'stripe')),
  access_token_iv text NOT NULL,
  access_token_data text NOT NULL,
  refresh_token_iv text,
  refresh_token_data text,
  token_type varchar(32) DEFAULT 'Bearer',
  scope text,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  UNIQUE(user_id, provider)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_tokens_user_provider ON tokens(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_tokens_provider ON tokens(provider);
CREATE INDEX IF NOT EXISTS idx_tokens_expires_at ON tokens(expires_at);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists, then create it
DROP TRIGGER IF EXISTS update_tokens_updated_at ON tokens;
CREATE TRIGGER update_tokens_updated_at
  BEFORE UPDATE ON tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_tokens_updated_at();

-- Enable RLS
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only access their own tokens)
DROP POLICY IF EXISTS "Users can view their own tokens" ON tokens;
CREATE POLICY "Users can view their own tokens" ON tokens
  FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

DROP POLICY IF EXISTS "Users can insert their own tokens" ON tokens;
CREATE POLICY "Users can insert their own tokens" ON tokens
  FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

DROP POLICY IF EXISTS "Users can update their own tokens" ON tokens;
CREATE POLICY "Users can update their own tokens" ON tokens
  FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

DROP POLICY IF EXISTS "Users can delete their own tokens" ON tokens;
CREATE POLICY "Users can delete their own tokens" ON tokens
  FOR DELETE USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

-- Add comment
COMMENT ON TABLE tokens IS 'OAuth tokens stored with encrypted IV+data format';


