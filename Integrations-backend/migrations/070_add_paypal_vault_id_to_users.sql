-- Add paypal_payment_token to users table for Auto-Charging
ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal_payment_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal_email TEXT;

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_users_paypal_payment_token ON users(paypal_payment_token) WHERE paypal_payment_token IS NOT NULL;
