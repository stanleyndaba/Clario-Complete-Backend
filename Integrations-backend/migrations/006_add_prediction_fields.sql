-- Migration: Add prediction fields to dispute_cases for payout estimator persistence

ALTER TABLE IF EXISTS dispute_cases
  ADD COLUMN IF NOT EXISTS expected_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS expected_paid_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2);

-- Optional indexes to support filtering/sorting by expected payout attributes
CREATE INDEX IF NOT EXISTS idx_dispute_cases_expected_paid_date ON dispute_cases(expected_paid_date);

-- Documentation
COMMENT ON COLUMN dispute_cases.expected_amount IS 'Predicted expected reimbursement amount for the dispute';
COMMENT ON COLUMN dispute_cases.expected_paid_date IS 'Predicted expected payout date for the dispute';
COMMENT ON COLUMN dispute_cases.confidence IS 'Confidence score (0..1) of the prediction';


