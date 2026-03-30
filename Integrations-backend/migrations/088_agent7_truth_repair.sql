-- Migration: 088_agent7_truth_repair
-- Purpose: Make Agent 7 filing proof authoritative and remove state lies.

ALTER TABLE dispute_submissions
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS seller_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submission_channel TEXT,
  ADD COLUMN IF NOT EXISTS external_reference TEXT,
  ADD COLUMN IF NOT EXISTS request_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attachment_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS shipment_id TEXT,
  ADD COLUMN IF NOT EXISTS asin TEXT,
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS claim_type TEXT,
  ADD COLUMN IF NOT EXISTS amount_claimed NUMERIC,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC,
  ADD COLUMN IF NOT EXISTS submission_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amount_approved NUMERIC,
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE dispute_submissions ds
SET
  tenant_id = dc.tenant_id,
  seller_id = COALESCE(ds.seller_id, dc.seller_id),
  user_id = COALESCE(
    NULLIF(ds.user_id, ''),
    CAST(sim.user_id AS TEXT),
    CAST(u.id AS TEXT),
    dc.seller_id
  ),
  order_id = COALESCE(
    NULLIF(ds.order_id, ''),
    NULLIF(dr.evidence->>'order_id', ''),
    NULLIF(dr.evidence->>'amazon_order_id', '')
  ),
  shipment_id = COALESCE(
    NULLIF(ds.shipment_id, ''),
    NULLIF(dr.evidence->>'shipment_id', ''),
    NULLIF(dr.evidence->>'fba_shipment_id', '')
  ),
  asin = COALESCE(
    NULLIF(ds.asin, ''),
    NULLIF(dr.evidence->>'asin', '')
  ),
  sku = COALESCE(
    NULLIF(ds.sku, ''),
    NULLIF(dr.evidence->>'sku', '')
  ),
  claim_type = COALESCE(
    NULLIF(ds.claim_type, ''),
    NULLIF(dc.case_type, '')
  ),
  amount_claimed = COALESCE(ds.amount_claimed, dc.claim_amount),
  currency = COALESCE(
    NULLIF(ds.currency, ''),
    NULLIF(dc.currency, ''),
    NULLIF(dr.currency, '')
  ),
  confidence_score = COALESCE(ds.confidence_score, dr.confidence_score),
  external_reference = COALESCE(
    NULLIF(ds.external_reference, ''),
    NULLIF(ds.amazon_case_id, ''),
    NULLIF(ds.submission_id, '')
  ),
  submission_timestamp = COALESCE(ds.submission_timestamp, ds.created_at),
  request_started_at = COALESCE(ds.request_started_at, ds.created_at),
  response_received_at = COALESCE(ds.response_received_at, ds.updated_at, ds.created_at),
  outcome = COALESCE(NULLIF(ds.outcome, ''), NULLIF(ds.status, '')),
  last_error = COALESCE(NULLIF(ds.last_error, ''), NULLIF(ds.error_message, ''))
FROM dispute_cases dc
LEFT JOIN detection_results dr
  ON dr.id = dc.detection_result_id
LEFT JOIN v1_seller_identity_map sim
  ON sim.merchant_token = dc.seller_id
LEFT JOIN users u
  ON u.amazon_seller_id = dc.seller_id
WHERE dc.id = ds.dispute_id
  AND (
    ds.tenant_id IS NULL OR
    ds.seller_id IS NULL OR
    ds.user_id IS NULL OR
    ds.order_id IS NULL OR
    ds.shipment_id IS NULL OR
    ds.asin IS NULL OR
    ds.sku IS NULL OR
    ds.claim_type IS NULL OR
    ds.amount_claimed IS NULL OR
    ds.currency IS NULL OR
    ds.confidence_score IS NULL OR
    ds.external_reference IS NULL OR
    ds.submission_timestamp IS NULL OR
    ds.request_started_at IS NULL OR
    ds.response_received_at IS NULL OR
    ds.outcome IS NULL OR
    ds.last_error IS NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_submissions_tenant_dispute_idempotency
  ON dispute_submissions(tenant_id, dispute_id, idempotency_key)
  WHERE tenant_id IS NOT NULL
    AND dispute_id IS NOT NULL
    AND idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispute_submissions_external_reference
  ON dispute_submissions(external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispute_submissions_tenant_dispute_created
  ON dispute_submissions(tenant_id, dispute_id, created_at DESC);

WITH proofless_filed_cases AS (
  SELECT dc.id
  FROM dispute_cases dc
  WHERE LOWER(COALESCE(dc.filing_status, '')) = 'filed'
    AND NOT EXISTS (
      SELECT 1
      FROM dispute_submissions ds
      WHERE ds.dispute_id = dc.id
        AND COALESCE(
          NULLIF(ds.external_reference, ''),
          NULLIF(ds.amazon_case_id, ''),
          CASE
            WHEN LOWER(COALESCE(ds.outcome, ds.status, '')) IN ('submitted', 'accepted', 'filed', 'success', 'open', 'in_progress')
              THEN NULLIF(ds.submission_id, '')
            ELSE NULL
          END
        ) IS NOT NULL
    )
)
UPDATE dispute_cases dc
SET
  filing_status = 'failed',
  status = 'open',
  last_error = COALESCE(NULLIF(dc.last_error, ''), 'Submission proof missing after Agent 7 truth repair'),
  updated_at = NOW()
FROM proofless_filed_cases proofless
WHERE dc.id = proofless.id;

UPDATE dispute_cases dc
SET
  status = 'open',
  last_error = COALESCE(NULLIF(dc.last_error, ''), 'Status normalized because no verified submission proof exists'),
  updated_at = NOW()
WHERE LOWER(COALESCE(dc.status, '')) = 'approved'
  AND LOWER(COALESCE(dc.filing_status, '')) IN ('pending', 'retrying', 'submitting', 'blocked', 'failed')
  AND COALESCE(NULLIF(dc.amazon_case_id, ''), NULLIF(dc.provider_case_id, '')) IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM dispute_submissions ds
    WHERE ds.dispute_id = dc.id
      AND COALESCE(
        NULLIF(ds.external_reference, ''),
        NULLIF(ds.amazon_case_id, ''),
        CASE
          WHEN LOWER(COALESCE(ds.outcome, ds.status, '')) IN ('submitted', 'accepted', 'filed', 'success', 'open', 'in_progress')
            THEN NULLIF(ds.submission_id, '')
          ELSE NULL
        END
      ) IS NOT NULL
  );

COMMENT ON TABLE dispute_submissions IS 'Authoritative Agent 7 filing proof ledger with request/response submission artifacts.';
