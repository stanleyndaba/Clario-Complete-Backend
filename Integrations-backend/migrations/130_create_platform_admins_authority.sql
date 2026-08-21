-- Canonical server-owned platform-admin authority.
-- Platform administration is intentionally distinct from tenant membership: a
-- workspace owner must not gain global publication or operator authority.

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'suspended', 'revoked')),
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_active
  ON platform_admins(user_id)
  WHERE status = 'active' AND revoked_at IS NULL;

DO $$
DECLARE
  matched_admin_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO matched_admin_count
  FROM users
  WHERE lower(email) IN (
    'sbiyarmvelorh@gmail.com',
    'mvelocloud7@gmail.com'
  )
    AND deleted_at IS NULL;

  IF matched_admin_count <> 2 THEN
    RAISE EXCEPTION
      'PLATFORM_ADMIN_BOOTSTRAP_IDENTITY_MISMATCH: expected exactly two active confirmed administrator accounts, found %',
      matched_admin_count;
  END IF;

  INSERT INTO platform_admins (user_id, status)
  SELECT id, 'active'
  FROM users
  WHERE lower(email) IN (
    'sbiyarmvelorh@gmail.com',
    'mvelocloud7@gmail.com'
  )
    AND deleted_at IS NULL
  ON CONFLICT (user_id) DO UPDATE
  SET status = 'active',
      revoked_at = NULL,
      updated_at = NOW();
END $$;

COMMENT ON TABLE platform_admins IS
  'Canonical global Margin platform-administrator authority. It is not derived from tenant ownership or membership roles.';
