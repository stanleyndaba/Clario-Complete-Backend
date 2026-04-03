-- Migration: 102_agent7_pre_filing_truth_gate
-- Purpose: persist Agent 7 pre-filing truth gate state so duplicate and completeness safety is durable.

BEGIN;

ALTER TABLE dispute_cases
  ADD COLUMN IF NOT EXISTS eligibility_status TEXT
    CHECK (
      eligibility_status IS NULL
      OR eligibility_status IN ('READY', 'DUPLICATE_BLOCKED', 'INSUFFICIENT_DATA', 'THREAD_ONLY', 'SAFETY_HOLD')
    );

DO $$
DECLARE
  has_dispute_case_write_trigger BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'dispute_cases'::regclass
      AND tgname = 'enforce_tenant_active_dispute_cases'
      AND NOT tgisinternal
  ) INTO has_dispute_case_write_trigger;

  IF has_dispute_case_write_trigger THEN
    EXECUTE 'ALTER TABLE dispute_cases DISABLE TRIGGER enforce_tenant_active_dispute_cases';
  END IF;

  UPDATE dispute_cases
  SET eligibility_status = CASE
    WHEN case_origin = 'amazon_thread_backfill' THEN 'THREAD_ONLY'
    WHEN filing_status = 'duplicate_blocked' THEN 'DUPLICATE_BLOCKED'
    WHEN filing_status = 'pending_safety_verification' THEN 'INSUFFICIENT_DATA'
    WHEN eligible_to_file = true AND filing_status IN ('pending', 'retrying') THEN 'READY'
    ELSE 'SAFETY_HOLD'
  END
  WHERE eligibility_status IS NULL;

  IF has_dispute_case_write_trigger THEN
    EXECUTE 'ALTER TABLE dispute_cases ENABLE TRIGGER enforce_tenant_active_dispute_cases';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    IF has_dispute_case_write_trigger THEN
      BEGIN
        EXECUTE 'ALTER TABLE dispute_cases ENABLE TRIGGER enforce_tenant_active_dispute_cases';
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;
    RAISE;
END $$;

ALTER TABLE dispute_cases
  ALTER COLUMN eligibility_status SET DEFAULT 'SAFETY_HOLD';

CREATE INDEX IF NOT EXISTS idx_dispute_cases_eligibility_status
  ON dispute_cases(tenant_id, eligibility_status, updated_at DESC);

COMMENT ON COLUMN dispute_cases.eligibility_status IS 'Canonical Agent 7 pre-filing truth gate: READY, DUPLICATE_BLOCKED, INSUFFICIENT_DATA, THREAD_ONLY, or SAFETY_HOLD.';

COMMIT;
