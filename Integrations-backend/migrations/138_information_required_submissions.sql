CREATE TABLE IF NOT EXISTS information_required_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note text NULL,
  status text NOT NULL DEFAULT 'review_pending',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT information_required_submissions_status_check CHECK (status IN ('review_pending', 'under_review', 'completed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS information_required_submissions_audit_unique
  ON information_required_submissions(audit_run_id);
CREATE INDEX IF NOT EXISTS information_required_submissions_tenant_idx
  ON information_required_submissions(tenant_id, submitted_at DESC);

ALTER TABLE evidence_documents
  ADD COLUMN IF NOT EXISTS information_required_submission_id uuid NULL REFERENCES information_required_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS evidence_documents_information_submission_idx
  ON evidence_documents(information_required_submission_id);
