-- Tenant-owned recurring audit schedule settings for Recovery Workspace subscribers.

CREATE TABLE IF NOT EXISTS audit_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL DEFAULT 'off' CHECK (cadence IN ('off', 'weekly', 'biweekly', 'monthly')),
  preferred_day_of_week INTEGER CHECK (preferred_day_of_week IS NULL OR preferred_day_of_week BETWEEN 0 AND 6),
  preferred_day_of_month INTEGER CHECK (preferred_day_of_month IS NULL OR preferred_day_of_month BETWEEN 1 AND 28),
  preferred_time TEXT NOT NULL DEFAULT '09:00' CHECK (preferred_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  is_paused BOOLEAN NOT NULL DEFAULT false,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_acquired_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_schedules_tenant_once
  ON audit_schedules(tenant_id);

CREATE INDEX IF NOT EXISTS idx_audit_schedules_next_run
  ON audit_schedules(next_run_at)
  WHERE cadence <> 'off' AND is_paused = false;

CREATE INDEX IF NOT EXISTS idx_audit_schedules_lease
  ON audit_schedules(lease_expires_at)
  WHERE cadence <> 'off' AND is_paused = false;
