-- Migration: Add stripe_customer_id reference for Stripe mapping
BEGIN;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS stripe_customer_id INT NULL;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id
ON users (stripe_customer_id);

COMMIT;

