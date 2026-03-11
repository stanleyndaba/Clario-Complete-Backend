-- 065: Create inventory_ledger_events table
-- This table stores raw inventory ledger events from CSV uploads
-- so that the Whale Hunter detection algorithm can read them directly.
-- Previously, inventory CSV data went into inventory_items but the
-- detection algorithms never read from that table.

CREATE TABLE IF NOT EXISTS inventory_ledger_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    tenant_id       TEXT,
    store_id        TEXT,
    sync_id         TEXT NOT NULL,
    fnsku           TEXT NOT NULL,
    asin            TEXT,
    sku             TEXT,
    product_name    TEXT,
    event_type      TEXT NOT NULL,           -- Receipt, Shipment, Adjustment, Return, Removal, Disposal, Transfer, Snapshot
    quantity        INTEGER NOT NULL DEFAULT 0,
    quantity_direction TEXT NOT NULL DEFAULT 'in',  -- 'in' or 'out'
    warehouse_balance  INTEGER,              -- Ending balance (for Snapshot events)
    event_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
    fulfillment_center TEXT,
    disposition     TEXT,                    -- SELLABLE, DAMAGED, etc.
    reason          TEXT,
    reference_id    TEXT,                    -- Shipment ID, Order ID, Transfer ID, etc.
    unit_cost       NUMERIC(12,2),
    average_sales_price NUMERIC(12,2),
    country         TEXT DEFAULT 'US',
    raw_payload     JSONB,
    source          TEXT DEFAULT 'csv_upload',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performant queries by the Whale Hunter algorithm
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_events_user_id ON inventory_ledger_events(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_events_sync_id ON inventory_ledger_events(sync_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_events_fnsku ON inventory_ledger_events(fnsku);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_events_event_date ON inventory_ledger_events(event_date);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_events_tenant_id ON inventory_ledger_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_events_user_fnsku ON inventory_ledger_events(user_id, fnsku);
