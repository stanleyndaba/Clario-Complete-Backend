-- Agent 3 calibration sprint: preserve CSV duplicate observations without
-- breaking the canonical order natural key.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_metadata_gin
  ON orders USING GIN (metadata);

COMMENT ON COLUMN orders.metadata IS
  'Structured ingestion metadata, including CSV duplicate/conflict observations collapsed under the canonical order row.';
