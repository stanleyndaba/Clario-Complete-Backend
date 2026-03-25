BEGIN;

ALTER TABLE recoveries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

WITH ranked_reimbursements AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, amazon_reimbursement_id
      ORDER BY created_at DESC, id DESC
    ) AS row_num
  FROM recoveries
  WHERE amazon_reimbursement_id IS NOT NULL
    AND deleted_at IS NULL
),
ranked_disputes AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, dispute_id
      ORDER BY created_at DESC, id DESC
    ) AS row_num
  FROM recoveries
  WHERE dispute_id IS NOT NULL
    AND deleted_at IS NULL
)
UPDATE recoveries
SET
  deleted_at = NOW(),
  reconciliation_status = 'failed',
  updated_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_reimbursements WHERE row_num > 1
  UNION
  SELECT id FROM ranked_disputes WHERE row_num > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recoveries_unique_reimbursement_truth
  ON recoveries(tenant_id, amazon_reimbursement_id)
  WHERE amazon_reimbursement_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recoveries_unique_dispute_truth
  ON recoveries(tenant_id, dispute_id)
  WHERE dispute_id IS NOT NULL
    AND deleted_at IS NULL;

COMMENT ON INDEX idx_recoveries_unique_reimbursement_truth IS 'Prevents the same Amazon reimbursement truth from being inserted twice for a tenant.';
COMMENT ON INDEX idx_recoveries_unique_dispute_truth IS 'Prevents multiple live recovery rows for the same dispute case.';

COMMIT;
