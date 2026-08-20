-- Migration 126: Align the dispute filing-state constraint with the Agent 7 eligibility persistence contract.
-- `evaluateAndPersistCaseEligibility` persists `pending_safety_verification` when evidence is incomplete.
-- Without this permitted state, a protected filing-approval request can fail after authorization but before its
-- authoritative post-approval transition.

BEGIN;

ALTER TABLE dispute_cases
  DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;

ALTER TABLE dispute_cases
  ADD CONSTRAINT dispute_cases_filing_status_check
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
    'pending_approval',
    'pending_safety_verification'
  ));

COMMENT ON COLUMN dispute_cases.filing_status IS
  'Canonical filing lifecycle state, including pending_safety_verification for incomplete or unsafe evidence.';

COMMIT;
