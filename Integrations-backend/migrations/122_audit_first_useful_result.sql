ALTER TABLE audit_runs
  ADD COLUMN IF NOT EXISTS first_useful_result_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS first_useful_result jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_runs_first_useful_result_at
  ON audit_runs(first_useful_result_at)
  WHERE first_useful_result_at IS NOT NULL;
