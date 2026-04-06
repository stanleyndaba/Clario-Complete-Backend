-- Migration: 103_add_detection_results_source_type
-- Purpose: Harden detection_results provenance with explicit source_type attribution.

ALTER TABLE detection_results
  ADD COLUMN IF NOT EXISTS source_type TEXT;

COMMENT ON COLUMN detection_results.source_type IS
  'Explicit ingestion provenance for this detection result: sp_api, csv_upload, or unknown after historical backfill.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'enforce_tenant_active_detection_results'
      AND tgrelid = 'detection_results'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE detection_results DISABLE TRIGGER enforce_tenant_active_detection_results';
  END IF;
END $$;

UPDATE detection_results
SET source_type = 'csv_upload'
WHERE source_type IS NULL
  AND sync_id IS NOT NULL
  AND sync_id LIKE 'csv_%';

UPDATE detection_results dr
SET source_type = 'csv_upload'
FROM csv_upload_runs cur
WHERE dr.source_type IS NULL
  AND dr.sync_id = cur.sync_id
  AND dr.tenant_id = cur.tenant_id;

WITH queue_sources AS (
  SELECT
    tenant_id::TEXT AS tenant_id,
    seller_id::TEXT AS seller_id,
    sync_id::TEXT AS sync_id,
    CASE
      WHEN COUNT(DISTINCT COALESCE(payload->>'source_type', payload->>'source')) = 1 THEN MIN(COALESCE(payload->>'source_type', payload->>'source'))
      ELSE 'unknown'
    END AS resolved_source
  FROM detection_queue
  WHERE sync_id IS NOT NULL
    AND (payload ? 'source_type' OR payload ? 'source')
    AND COALESCE(payload->>'source_type', payload->>'source') IN ('sp_api', 'csv_upload')
  GROUP BY tenant_id, seller_id, sync_id
)
UPDATE detection_results dr
SET source_type = queue_sources.resolved_source
FROM queue_sources
WHERE dr.source_type IS NULL
  AND dr.tenant_id::TEXT = queue_sources.tenant_id
  AND dr.seller_id::TEXT = queue_sources.seller_id
  AND dr.sync_id = queue_sources.sync_id;

WITH sync_sources AS (
  SELECT
    tenant_id,
    sync_id,
    CASE
      WHEN COUNT(DISTINCT source) = 1 THEN MIN(source)
      ELSE 'unknown'
    END AS resolved_source
  FROM (
    SELECT tenant_id::TEXT AS tenant_id, sync_id::TEXT AS sync_id, source::TEXT AS source
    FROM orders
    WHERE sync_id IS NOT NULL AND source IN ('sp_api', 'csv_upload')
    UNION ALL
    SELECT tenant_id::TEXT AS tenant_id, sync_id::TEXT AS sync_id, source::TEXT AS source
    FROM shipments
    WHERE sync_id IS NOT NULL AND source IN ('sp_api', 'csv_upload')
    UNION ALL
    SELECT tenant_id::TEXT AS tenant_id, sync_id::TEXT AS sync_id, source::TEXT AS source
    FROM returns
    WHERE sync_id IS NOT NULL AND source IN ('sp_api', 'csv_upload')
    UNION ALL
    SELECT tenant_id::TEXT AS tenant_id, sync_id::TEXT AS sync_id, source::TEXT AS source
    FROM settlements
    WHERE sync_id IS NOT NULL AND source IN ('sp_api', 'csv_upload')
    UNION ALL
    SELECT tenant_id::TEXT AS tenant_id, sync_id::TEXT AS sync_id, source::TEXT AS source
    FROM financial_events
    WHERE sync_id IS NOT NULL AND source IN ('sp_api', 'csv_upload')
    UNION ALL
    SELECT tenant_id::TEXT AS tenant_id, sync_id::TEXT AS sync_id, source::TEXT AS source
    FROM inventory_ledger_events
    WHERE sync_id IS NOT NULL AND source IN ('sp_api', 'csv_upload')
    UNION ALL
    SELECT tenant_id::TEXT AS tenant_id, sync_id::TEXT AS sync_id, source::TEXT AS source
    FROM inventory_transfers
    WHERE sync_id IS NOT NULL AND source IN ('sp_api', 'csv_upload')
  ) source_rows
  GROUP BY tenant_id, sync_id
)
UPDATE detection_results dr
SET source_type = sync_sources.resolved_source
FROM sync_sources
WHERE dr.source_type IS NULL
  AND dr.tenant_id::TEXT = sync_sources.tenant_id
  AND dr.sync_id = sync_sources.sync_id;

UPDATE detection_results
SET source_type = 'unknown'
WHERE source_type IS NULL;

ALTER TABLE detection_results
  DROP CONSTRAINT IF EXISTS detection_results_source_type_check;

ALTER TABLE detection_results
  ADD CONSTRAINT detection_results_source_type_check
  CHECK (source_type IN ('sp_api', 'csv_upload', 'unknown'));

ALTER TABLE detection_results
  ALTER COLUMN source_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_detection_results_tenant_source_type
  ON detection_results (tenant_id, source_type);

CREATE INDEX IF NOT EXISTS idx_detection_results_sync_source_type
  ON detection_results (sync_id, source_type);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'enforce_tenant_active_detection_results'
      AND tgrelid = 'detection_results'::regclass
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE detection_results ENABLE TRIGGER enforce_tenant_active_detection_results';
  END IF;
END $$;
