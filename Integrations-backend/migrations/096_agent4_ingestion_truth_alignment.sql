-- Migration: 096_agent4_ingestion_truth_alignment
-- Purpose: align Agent 4 ingestion truth on tenant-bound source resolution and a single ingestion timestamp.

ALTER TABLE evidence_sources
  ADD COLUMN IF NOT EXISTS last_ingested_at TIMESTAMPTZ;

UPDATE evidence_sources
SET last_ingested_at = COALESCE(
  last_ingested_at,
  last_sync_at,
  last_synced_at,
  NULLIF(metadata->>'last_ingested_at', '')::timestamptz,
  NULLIF(metadata->>'last_sync_at', '')::timestamptz,
  NULLIF(metadata->>'last_synced_at', '')::timestamptz
)
WHERE last_ingested_at IS NULL
  AND (
    last_sync_at IS NOT NULL
    OR last_synced_at IS NOT NULL
    OR metadata ? 'last_ingested_at'
    OR metadata ? 'last_sync_at'
    OR metadata ? 'last_synced_at'
  );

CREATE INDEX IF NOT EXISTS idx_evidence_sources_tenant_last_ingested_at
  ON evidence_sources(tenant_id, last_ingested_at DESC)
  WHERE last_ingested_at IS NOT NULL;

COMMENT ON COLUMN evidence_sources.last_ingested_at IS 'Canonical Agent 4 timestamp for successful document ingestion. Connection alone must not populate this field.';
