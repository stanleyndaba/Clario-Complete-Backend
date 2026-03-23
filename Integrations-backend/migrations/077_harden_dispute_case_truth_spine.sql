-- Migration: 077_harden_dispute_case_truth_spine.sql
-- Purpose: Make dispute_cases the canonical truth spine for Agent 7/8/9 lifecycle data.

BEGIN;

ALTER TABLE dispute_cases
  ADD COLUMN IF NOT EXISTS amazon_case_id TEXT,
  ADD COLUMN IF NOT EXISTS estimated_recovery_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS approved_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS recovered_amount DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS block_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS eligible_to_file BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;

ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check
  CHECK (filing_status IN (
    'pending',
    'blocked',
    'filing',
    'submitting',
    'recovering',
    'payment_required',
    'filed',
    'retrying',
    'failed',
    'quarantined_dangerous_doc',
    'duplicate_blocked',
    'already_reimbursed',
    'pending_approval'
  ));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'dispute_cases'
      AND column_name = 'provider_case_id'
  ) THEN
    EXECUTE $update_with_provider$
      UPDATE dispute_cases
      SET
        estimated_recovery_amount = COALESCE(estimated_recovery_amount, claim_amount),
        approved_amount = COALESCE(
          approved_amount,
          CASE
            WHEN lower(COALESCE(status, '')) IN ('approved', 'won') THEN claim_amount
            ELSE NULL
          END
        ),
        recovered_amount = COALESCE(recovered_amount, actual_payout_amount),
        rejection_reason = COALESCE(rejection_reason, evidence_attachments ->> 'raw_reason_text'),
        amazon_case_id = COALESCE(NULLIF(amazon_case_id, ''), NULLIF(provider_case_id, '')),
        block_reasons = CASE
          WHEN jsonb_typeof(block_reasons) = 'array' THEN block_reasons
          ELSE '[]'::jsonb
        END
      WHERE TRUE
    $update_with_provider$;
  ELSE
    EXECUTE $update_without_provider$
      UPDATE dispute_cases
      SET
        estimated_recovery_amount = COALESCE(estimated_recovery_amount, claim_amount),
        approved_amount = COALESCE(
          approved_amount,
          CASE
            WHEN lower(COALESCE(status, '')) IN ('approved', 'won') THEN claim_amount
            ELSE NULL
          END
        ),
        recovered_amount = COALESCE(recovered_amount, actual_payout_amount),
        rejection_reason = COALESCE(rejection_reason, evidence_attachments ->> 'raw_reason_text'),
        block_reasons = CASE
          WHEN jsonb_typeof(block_reasons) = 'array' THEN block_reasons
          ELSE '[]'::jsonb
        END
      WHERE TRUE
    $update_without_provider$;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispute_cases_amazon_case_id
  ON dispute_cases(amazon_case_id)
  WHERE amazon_case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispute_cases_eligible_to_file
  ON dispute_cases(tenant_id, eligible_to_file, filing_status);

CREATE INDEX IF NOT EXISTS idx_dispute_cases_rejected_at
  ON dispute_cases(tenant_id, rejected_at DESC)
  WHERE rejected_at IS NOT NULL;

COMMENT ON COLUMN dispute_cases.estimated_recovery_amount IS 'Canonical estimated recovery amount before Amazon decision';
COMMENT ON COLUMN dispute_cases.approved_amount IS 'Canonical amount explicitly approved by Amazon';
COMMENT ON COLUMN dispute_cases.recovered_amount IS 'Canonical amount actually recovered/reconciled';
COMMENT ON COLUMN dispute_cases.rejection_reason IS 'Canonical rejection reason for the dispute case';
COMMENT ON COLUMN dispute_cases.rejected_at IS 'Timestamp when the case was marked rejected';
COMMENT ON COLUMN dispute_cases.last_error IS 'Latest filing/retry failure reason for the dispute case';
COMMENT ON COLUMN dispute_cases.block_reasons IS 'Canonical array of explicit reasons why Agent 7 cannot file the case';
COMMENT ON COLUMN dispute_cases.eligible_to_file IS 'Canonical Agent 7 gate result for whether this case may leave the system';
COMMENT ON COLUMN dispute_cases.amazon_case_id IS 'Canonical external Amazon case identifier for the dispute case';
COMMENT ON COLUMN dispute_cases.filing_status IS 'Canonical filing state: pending, blocked, filing, submitting, recovering, payment_required, filed, retrying, failed, quarantined_dangerous_doc, duplicate_blocked, already_reimbursed, pending_approval';

COMMIT;
