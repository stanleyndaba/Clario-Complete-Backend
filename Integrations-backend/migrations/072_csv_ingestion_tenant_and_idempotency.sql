-- ========================================
-- Migration: 072_csv_ingestion_tenant_and_idempotency.sql
-- Purpose: make CSV ingestion tenant-safe and idempotent on live schema
-- ========================================

-- 1) inventory_items tenant scope
ALTER TABLE IF EXISTS inventory_items ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE inventory_items ii
SET tenant_id = u.tenant_id
FROM users u
WHERE ii.user_id::text = u.id::text
  AND ii.tenant_id IS NULL;

UPDATE inventory_items
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE IF EXISTS inventory_items ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_id ON inventory_items(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_tenant_user_sku_unique
  ON inventory_items (tenant_id, user_id, sku, asin, fnsku);

-- 2) inventory_ledger_events tenant scope + uniqueness
ALTER TABLE IF EXISTS inventory_ledger_events ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE inventory_ledger_events ile
SET tenant_id = u.tenant_id
FROM users u
WHERE ile.user_id::text = u.id::text
  AND ile.tenant_id IS NULL;

UPDATE inventory_ledger_events
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

ALTER TABLE IF EXISTS inventory_ledger_events ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_events_tenant_id ON inventory_ledger_events(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_events_tenant_user_event_unique
  ON inventory_ledger_events (tenant_id, user_id, fnsku, event_type, event_date, reference_id);

-- 3) financial_events idempotency key for CSV imports
CREATE UNIQUE INDEX IF NOT EXISTS financial_events_tenant_seller_event_unique
  ON financial_events (tenant_id, seller_id, event_type, event_date, amazon_order_id, amazon_sku, amount);

-- 4) CSV duplicate file protection table
CREATE TABLE IF NOT EXISTS csv_ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  csv_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS csv_ingestion_runs_tenant_user_type_hash_unique
  ON csv_ingestion_runs (tenant_id, user_id, csv_type, file_hash);

CREATE INDEX IF NOT EXISTS idx_csv_ingestion_runs_tenant_created
  ON csv_ingestion_runs (tenant_id, created_at DESC);
