-- Onboarding slots: hard cap access control for Amazon onboarding.
-- Promoted from src/database/migrations/007_create_onboarding_slots.sql because
-- production migrations are loaded from Integrations-backend/migrations.

CREATE TABLE IF NOT EXISTS onboarding_slots (
  user_id UUID PRIMARY KEY,
  tenant_id UUID,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS onboarding_slots_status_idx
  ON onboarding_slots(status);

CREATE INDEX IF NOT EXISTS onboarding_slots_expires_idx
  ON onboarding_slots(expires_at);

-- Atomic reservation: ensures max active slots are never exceeded.
CREATE OR REPLACE FUNCTION reserve_onboarding_slot(
  p_user_id uuid,
  p_tenant_id uuid,
  p_max integer,
  p_ttl_minutes integer DEFAULT 1440
)
RETURNS TABLE(allowed boolean, active_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  current_count integer;
  existing_active boolean;
BEGIN
  LOCK TABLE onboarding_slots IN EXCLUSIVE MODE;

  UPDATE onboarding_slots
  SET status = 'expired',
      released_at = now(),
      updated_at = now()
  WHERE status = 'active'
    AND expires_at <= now();

  SELECT EXISTS (
    SELECT 1 FROM onboarding_slots
    WHERE user_id = p_user_id
      AND status = 'active'
      AND expires_at > now()
  ) INTO existing_active;

  IF existing_active THEN
    SELECT count(*) INTO current_count
    FROM onboarding_slots
    WHERE status = 'active'
      AND expires_at > now();
    allowed := true;
    active_count := current_count;
    RETURN;
  END IF;

  SELECT count(*) INTO current_count
  FROM onboarding_slots
  WHERE status = 'active'
    AND expires_at > now();

  IF current_count >= p_max THEN
    allowed := false;
    active_count := current_count;
    RETURN;
  END IF;

  INSERT INTO onboarding_slots (
    user_id,
    tenant_id,
    status,
    started_at,
    expires_at,
    created_at,
    updated_at,
    metadata
  )
  VALUES (
    p_user_id,
    p_tenant_id,
    'active',
    now(),
    now() + (p_ttl_minutes || ' minutes')::interval,
    now(),
    now(),
    jsonb_build_object('reserved_at', now())
  )
  ON CONFLICT (user_id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    status = 'active',
    started_at = now(),
    expires_at = now() + (p_ttl_minutes || ' minutes')::interval,
    updated_at = now(),
    released_at = NULL,
    completed_at = NULL,
    metadata = onboarding_slots.metadata || jsonb_build_object('reserved_at', now());

  SELECT count(*) INTO current_count
  FROM onboarding_slots
  WHERE status = 'active'
    AND expires_at > now();

  allowed := true;
  active_count := current_count;
  RETURN;
END $$;

CREATE OR REPLACE FUNCTION complete_onboarding_slot(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE onboarding_slots
  SET status = 'completed',
      completed_at = now(),
      released_at = now(),
      updated_at = now()
  WHERE user_id = p_user_id
    AND status = 'active';
END $$;

