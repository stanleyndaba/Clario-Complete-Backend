-- ========================================
-- Migration: 073_create_inventory_transfers.sql
-- Purpose: restore the missing transfer-ingestion rail used by CSV uploads and Agent 3 Transfer Loss
-- ========================================

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  transfer_id TEXT NOT NULL,
  sku TEXT,
  asin TEXT,
  fnsku TEXT,
  source_fc TEXT,
  destination_fc TEXT,
  transfer_date TIMESTAMPTZ NOT NULL,
  expected_arrival_date TIMESTAMPTZ,
  actual_arrival_date TIMESTAMPTZ,
  quantity_sent INTEGER NOT NULL DEFAULT 0,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  unit_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  sync_id TEXT,
  source TEXT NOT NULL DEFAULT 'csv_upload',
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_tenant_seller
  ON inventory_transfers (tenant_id, seller_id);

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_transfer_date
  ON inventory_transfers (transfer_date DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_sku
  ON inventory_transfers (sku);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_transfers_tenant_seller_transfer_unique
  ON inventory_transfers (tenant_id, seller_id, transfer_id);
