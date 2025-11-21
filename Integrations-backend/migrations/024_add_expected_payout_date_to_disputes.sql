-- Migration: Ensure dispute_cases has expected payout tracking

ALTER TABLE dispute_cases
ADD COLUMN IF NOT EXISTS expected_payout_date TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dispute_cases_expected_payout
  ON dispute_cases(expected_payout_date);

