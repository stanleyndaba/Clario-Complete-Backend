-- Agent 2 hardening: tenant-scoped persistence + idempotent uniqueness

-- 1) Add tenant_id columns to Phase 2 source tables
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS shipments ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS returns ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS settlements ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS inventory_ledger ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- 2) Backfill tenant_id from users table where possible
UPDATE orders o
SET tenant_id = u.tenant_id
FROM users u
WHERE o.user_id::text = u.id::text
  AND o.tenant_id IS NULL;

UPDATE shipments s
SET tenant_id = u.tenant_id
FROM users u
WHERE s.user_id::text = u.id::text
  AND s.tenant_id IS NULL;

UPDATE returns r
SET tenant_id = u.tenant_id
FROM users u
WHERE r.user_id::text = u.id::text
  AND r.tenant_id IS NULL;

UPDATE settlements s
SET tenant_id = u.tenant_id
FROM users u
WHERE s.user_id::text = u.id::text
  AND s.tenant_id IS NULL;

UPDATE inventory_ledger il
SET tenant_id = u.tenant_id
FROM users u
WHERE il.seller_id = u.id::text
  AND il.tenant_id IS NULL;

-- 3) Assign unresolved legacy rows to default tenant (existing multi-tenant baseline)
DO $$
DECLARE
  default_tenant_id UUID := '00000000-0000-0000-0000-000000000001';
  unresolved_orders INT;
  unresolved_shipments INT;
  unresolved_returns INT;
  unresolved_settlements INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = default_tenant_id) THEN
    RAISE EXCEPTION 'Default tenant % does not exist. Run migrations 046/047 first.', default_tenant_id;
  END IF;

  UPDATE orders SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE shipments SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE returns SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE settlements SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  SELECT COUNT(*) INTO unresolved_orders FROM orders WHERE tenant_id IS NULL;
  SELECT COUNT(*) INTO unresolved_shipments FROM shipments WHERE tenant_id IS NULL;
  SELECT COUNT(*) INTO unresolved_returns FROM returns WHERE tenant_id IS NULL;
  SELECT COUNT(*) INTO unresolved_settlements FROM settlements WHERE tenant_id IS NULL;

  IF unresolved_orders > 0 OR unresolved_shipments > 0 OR unresolved_returns > 0 OR unresolved_settlements > 0 THEN
    RAISE EXCEPTION 'Agent2 migration failed after default-tenant fallback: unresolved tenant_id rows remain (orders %, shipments %, returns %, settlements %)',
      unresolved_orders, unresolved_shipments, unresolved_returns, unresolved_settlements;
  END IF;
END $$;

-- 4) Enforce NOT NULL on tenant-scoped source tables
ALTER TABLE IF EXISTS orders ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE IF EXISTS shipments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE IF EXISTS returns ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE IF EXISTS settlements ALTER COLUMN tenant_id SET NOT NULL;

-- inventory_ledger may have legacy rows without user mapping; keep nullable but indexed/unique where present.

-- 5) Replace legacy uniqueness with tenant-safe uniqueness
ALTER TABLE IF EXISTS orders DROP CONSTRAINT IF EXISTS orders_user_id_order_id_key;
ALTER TABLE IF EXISTS shipments DROP CONSTRAINT IF EXISTS shipments_user_id_shipment_id_key;
ALTER TABLE IF EXISTS returns DROP CONSTRAINT IF EXISTS returns_user_id_return_id_key;
ALTER TABLE IF EXISTS settlements DROP CONSTRAINT IF EXISTS settlements_user_id_settlement_id_transaction_type_key;

ALTER TABLE IF EXISTS orders
  ADD CONSTRAINT orders_tenant_user_order_unique UNIQUE (tenant_id, user_id, order_id);
ALTER TABLE IF EXISTS shipments
  ADD CONSTRAINT shipments_tenant_user_shipment_unique UNIQUE (tenant_id, user_id, shipment_id);
ALTER TABLE IF EXISTS returns
  ADD CONSTRAINT returns_tenant_user_return_unique UNIQUE (tenant_id, user_id, return_id);
ALTER TABLE IF EXISTS settlements
  ADD CONSTRAINT settlements_tenant_user_settlement_type_unique UNIQUE (tenant_id, user_id, settlement_id, transaction_type);

-- inventory_ledger unique key (best-effort; only where tenant_id is populated)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'inventory_ledger'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_tenant_event_unique
      ON inventory_ledger (tenant_id, seller_id, event_date, fnsku, event_type, reference_id);
  END IF;
END $$;

-- 6) Performance indexes for tenant-scoped reads
CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tenant_id ON shipments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_returns_tenant_id ON returns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_id ON settlements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_tenant_id ON inventory_ledger(tenant_id);
