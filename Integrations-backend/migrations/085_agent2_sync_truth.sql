-- Migration: 085_agent2_sync_truth
-- Purpose: Harden Agent 2 sync progress lineage for tenant/store-scoped truth

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

ALTER TABLE detection_results
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

ALTER TABLE sync_progress
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE sync_progress
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sync_progress_tenant_id
  ON sync_progress(tenant_id);

CREATE INDEX IF NOT EXISTS idx_sync_progress_tenant_user_created_at
  ON sync_progress(tenant_id, user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_sync_progress_tenant_store_created_at
  ON sync_progress(tenant_id, store_id, created_at);
