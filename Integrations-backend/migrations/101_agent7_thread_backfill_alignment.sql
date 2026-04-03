-- Migration: 101_agent7_thread_backfill_alignment
-- Purpose: preserve unmatched Amazon thread provenance while allowing safe manual linking and placeholder dispute case creation.

BEGIN;

ALTER TABLE dispute_cases
  ALTER COLUMN detection_result_id DROP NOT NULL;

ALTER TABLE dispute_cases
  ADD COLUMN IF NOT EXISTS case_origin TEXT NOT NULL DEFAULT 'detection_pipeline'
    CHECK (case_origin IN ('detection_pipeline', 'amazon_thread_backfill'));

ALTER TABLE dispute_cases
  ADD COLUMN IF NOT EXISTS origin_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE dispute_cases
  ADD COLUMN IF NOT EXISTS thread_backfilled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dispute_cases_case_origin
  ON dispute_cases(tenant_id, case_origin, updated_at DESC);

ALTER TABLE unmatched_case_messages
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE unmatched_case_messages
  ADD COLUMN IF NOT EXISTS linked_dispute_case_id UUID REFERENCES dispute_cases(id) ON DELETE SET NULL;

ALTER TABLE unmatched_case_messages
  ADD COLUMN IF NOT EXISTS link_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (link_status IN ('unmatched', 'linked_existing_case', 'linked_placeholder_case'));

ALTER TABLE unmatched_case_messages
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE unmatched_case_messages
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE unmatched_case_messages
  ADD COLUMN IF NOT EXISTS resolution_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_unmatched_case_messages_link_status
  ON unmatched_case_messages(tenant_id, link_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_unmatched_case_messages_linked_case
  ON unmatched_case_messages(tenant_id, linked_dispute_case_id)
  WHERE linked_dispute_case_id IS NOT NULL;

COMMENT ON COLUMN dispute_cases.case_origin IS 'How the dispute case entered Margin truth: detection_pipeline or amazon_thread_backfill.';
COMMENT ON COLUMN dispute_cases.origin_metadata IS 'Provenance metadata for special dispute case creation paths such as Amazon thread backfill.';
COMMENT ON COLUMN dispute_cases.thread_backfilled_at IS 'Timestamp when Margin linked an existing Amazon support thread into the dispute case.';
COMMENT ON COLUMN unmatched_case_messages.user_id IS 'Connected Gmail user that originally surfaced the unmatched Amazon support email.';
COMMENT ON COLUMN unmatched_case_messages.link_status IS 'Resolution state for unmatched Amazon support emails: unmatched or linked to a dispute case.';
COMMENT ON COLUMN unmatched_case_messages.linked_dispute_case_id IS 'Dispute case eventually linked to the unmatched Amazon support email.';
COMMENT ON COLUMN unmatched_case_messages.resolution_metadata IS 'Operator/backfill provenance for how an unmatched Amazon email was linked.';

COMMIT;
