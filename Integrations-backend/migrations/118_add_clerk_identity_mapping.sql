ALTER TABLE users
  ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user_id_unique
  ON users(clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

COMMENT ON COLUMN users.clerk_user_id IS
  'Current Clerk user identifier mapped to the stable Margin/Neon user row.';
