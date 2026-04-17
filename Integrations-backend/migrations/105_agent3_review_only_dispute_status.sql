-- Agent 3 calibration sprint: review-only detections must not be represented
-- as submitted or approved dispute cases.

ALTER TABLE dispute_cases
  DROP CONSTRAINT IF EXISTS dispute_cases_status_check;

ALTER TABLE dispute_cases
  ADD CONSTRAINT dispute_cases_status_check
  CHECK (status IN (
    'pending',
    'submitted',
    'approved',
    'rejected',
    'closed',
    'review_needed',
    'do_not_file'
  ));

COMMENT ON COLUMN dispute_cases.status IS
  'Case lifecycle status. Review-only Agent 3 findings use review_needed/do_not_file and must not be promoted to submitted or approved.';

