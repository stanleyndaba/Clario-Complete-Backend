-- Migration: 079_close_loop_intelligence
-- Phase 3: Closed-loop intelligence outcome normalization

ALTER TABLE detection_outcomes
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS dispute_case_id UUID REFERENCES dispute_cases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome_status TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejection_category TEXT,
  ADD COLUMN IF NOT EXISTS approved_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS confidence_score_at_time NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS evidence_strength NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS success_probability_at_time NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS filing_strategy JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_detection_outcomes_tenant
  ON detection_outcomes(tenant_id);

CREATE INDEX IF NOT EXISTS idx_detection_outcomes_tenant_anomaly
  ON detection_outcomes(tenant_id, anomaly_type);

CREATE INDEX IF NOT EXISTS idx_detection_outcomes_dispute_case
  ON detection_outcomes(dispute_case_id);

UPDATE detection_outcomes AS outcomes
SET
  tenant_id = COALESCE(outcomes.tenant_id, detection.tenant_id, dispute.tenant_id),
  dispute_case_id = COALESCE(outcomes.dispute_case_id, dispute.id),
  outcome_status = COALESCE(outcomes.outcome_status, outcomes.actual_outcome),
  rejection_reason = COALESCE(outcomes.rejection_reason, outcomes.amazon_response_reason),
  approved_amount = COALESCE(outcomes.approved_amount, NULLIF(outcomes.recovery_amount, 0)),
  confidence_score_at_time = COALESCE(outcomes.confidence_score_at_time, outcomes.predicted_confidence),
  outcome_recorded_at = COALESCE(outcomes.outcome_recorded_at, outcomes.created_at)
FROM detection_results AS detection
LEFT JOIN dispute_cases AS dispute
  ON dispute.detection_result_id = detection.id
WHERE outcomes.detection_result_id = detection.id;

UPDATE detection_outcomes
SET filing_strategy = '{}'::jsonb
WHERE filing_strategy IS NULL;

COMMENT ON COLUMN detection_outcomes.outcome_status IS 'Normalized terminal outcome status for learning and live decision feedback.';
COMMENT ON COLUMN detection_outcomes.rejection_reason IS 'Raw rejection reason from Amazon or the filing system.';
COMMENT ON COLUMN detection_outcomes.rejection_category IS 'Structured rejection category used for adaptive decisioning.';
COMMENT ON COLUMN detection_outcomes.evidence_strength IS 'Normalized evidence-strength score captured at filing or outcome time.';
COMMENT ON COLUMN detection_outcomes.success_probability_at_time IS 'Adaptive success probability snapshot used when the case was filed.';
