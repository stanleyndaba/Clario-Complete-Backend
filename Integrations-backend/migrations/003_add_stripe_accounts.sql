-- Silent Stripe Onboarding: Stripe Accounts Table
CREATE TABLE IF NOT EXISTS stripe_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_accounts_user_id ON stripe_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_accounts_stripe_account_id ON stripe_accounts(stripe_account_id);

-- Enable Row Level Security
ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY;

-- RLS: Only allow users to access their own stripe account
CREATE POLICY "Users can view their own stripe account" ON stripe_accounts
  FOR SELECT USING (auth.uid()::uuid = user_id);
CREATE POLICY "Users can insert their own stripe account" ON stripe_accounts
  FOR INSERT WITH CHECK (auth.uid()::uuid = user_id);
CREATE POLICY "Users can update their own stripe account" ON stripe_accounts
  FOR UPDATE USING (auth.uid()::uuid = user_id);
CREATE POLICY "Users can delete their own stripe account" ON stripe_accounts
  FOR DELETE USING (auth.uid()::uuid = user_id);