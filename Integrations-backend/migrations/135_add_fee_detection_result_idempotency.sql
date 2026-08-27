-- Migration: 135_add_fee_detection_result_idempotency
-- Purpose: make Fee Phantom finding persistence replay-safe for the same tenant,
-- seller, sync, anomaly type, and deterministic evidence identity.
--
-- This migration is source-only in S4 internal certification. It is not applied
-- or deployed by this phase.

ALTER TABLE IF EXISTS detection_results
  ADD COLUMN IF NOT EXISTS finding_fingerprint TEXT;

-- Existing historical rows intentionally remain outside the new unique identity
-- until a later controlled data-backfill decision. New S4 fee rows always carry
-- a non-null deterministic fingerprint.
-- PostgreSQL treats nulls as distinct in this unique index, so historical
-- detector rows without fingerprints remain unaffected. The full column index
-- is deliberately used (rather than a partial index) so PostgREST can target
-- it atomically through `onConflict` during replay-safe upsert.
CREATE UNIQUE INDEX IF NOT EXISTS detection_results_fee_fingerprint_unique
  ON detection_results (tenant_id, seller_id, sync_id, anomaly_type, finding_fingerprint);

CREATE INDEX IF NOT EXISTS idx_detection_results_fee_fingerprint_scope
  ON detection_results (tenant_id, seller_id, sync_id, anomaly_type)
  WHERE finding_fingerprint IS NOT NULL;

COMMENT ON COLUMN detection_results.finding_fingerprint IS
  'Deterministic S4 identity for replay-safe detection persistence. Fee Phantom uses tenant/seller/sync/anomaly plus canonical related-event evidence.';
