-- Migration 063: Create CSV data tables
-- Creates the 5 tables required by csvIngestionService.ts for CSV upload ingestion:
-- orders, shipments, returns, settlements, inventory_items
-- DROP + CREATE to ensure clean schema (no data loss — tables are new/empty)

-- ============================================================================
-- ORDERS
-- ============================================================================
DROP TABLE IF EXISTS orders CASCADE;
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    store_id TEXT,
    order_id TEXT NOT NULL,
    seller_id TEXT,
    marketplace_id TEXT DEFAULT 'ATVPDKIKX0DER',
    order_date TIMESTAMPTZ DEFAULT NOW(),
    order_status TEXT DEFAULT 'Shipped',
    fulfillment_channel TEXT DEFAULT 'FBA',
    total_amount NUMERIC(12, 2) DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    items JSONB DEFAULT '[]'::jsonb,
    quantities JSONB DEFAULT '{}'::jsonb,
    sync_id TEXT,
    sync_timestamp TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'csv_upload',
    is_sandbox BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_order_id ON orders(order_id);
CREATE INDEX idx_orders_store_id ON orders(store_id);
CREATE INDEX idx_orders_sync_id ON orders(sync_id);

-- ============================================================================
-- SHIPMENTS
-- ============================================================================
DROP TABLE IF EXISTS shipments CASCADE;
CREATE TABLE shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    store_id TEXT,
    shipment_id TEXT NOT NULL,
    order_id TEXT,
    shipped_date TIMESTAMPTZ DEFAULT NOW(),
    received_date TIMESTAMPTZ,
    status TEXT DEFAULT 'RECEIVED',
    carrier TEXT,
    tracking_number TEXT,
    warehouse_location TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    shipped_quantity INTEGER DEFAULT 0,
    received_quantity INTEGER DEFAULT 0,
    missing_quantity INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    sync_id TEXT,
    sync_timestamp TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'csv_upload',
    is_sandbox BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shipments_user_id ON shipments(user_id);
CREATE INDEX idx_shipments_shipment_id ON shipments(shipment_id);
CREATE INDEX idx_shipments_store_id ON shipments(store_id);
CREATE INDEX idx_shipments_sync_id ON shipments(sync_id);

-- ============================================================================
-- RETURNS
-- ============================================================================
DROP TABLE IF EXISTS returns CASCADE;
CREATE TABLE returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    store_id TEXT,
    return_id TEXT NOT NULL,
    order_id TEXT,
    reason TEXT DEFAULT 'CUSTOMER_REQUEST',
    returned_date TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'RECEIVED',
    refund_amount NUMERIC(12, 2) DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    items JSONB DEFAULT '[]'::jsonb,
    is_partial BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'::jsonb,
    sync_id TEXT,
    sync_timestamp TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'csv_upload',
    is_sandbox BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_returns_user_id ON returns(user_id);
CREATE INDEX idx_returns_return_id ON returns(return_id);
CREATE INDEX idx_returns_order_id ON returns(order_id);
CREATE INDEX idx_returns_store_id ON returns(store_id);
CREATE INDEX idx_returns_sync_id ON returns(sync_id);

-- ============================================================================
-- SETTLEMENTS
-- ============================================================================
DROP TABLE IF EXISTS settlements CASCADE;
CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    store_id TEXT,
    settlement_id TEXT NOT NULL,
    order_id TEXT,
    transaction_type TEXT DEFAULT 'Order',
    amount NUMERIC(12, 2) DEFAULT 0,
    fees NUMERIC(12, 2) DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    settlement_date TIMESTAMPTZ DEFAULT NOW(),
    fee_breakdown JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    sync_id TEXT,
    sync_timestamp TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'csv_upload',
    is_sandbox BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_settlements_user_id ON settlements(user_id);
CREATE INDEX idx_settlements_settlement_id ON settlements(settlement_id);
CREATE INDEX idx_settlements_store_id ON settlements(store_id);
CREATE INDEX idx_settlements_sync_id ON settlements(sync_id);

-- ============================================================================
-- INVENTORY ITEMS
-- ============================================================================
DROP TABLE IF EXISTS inventory_items CASCADE;
CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    store_id TEXT,
    sku TEXT NOT NULL,
    asin TEXT,
    fnsku TEXT,
    product_name TEXT,
    condition_type TEXT DEFAULT 'New',
    quantity_available INTEGER DEFAULT 0,
    quantity_reserved INTEGER DEFAULT 0,
    quantity_inbound INTEGER DEFAULT 0,
    price NUMERIC(12, 2) DEFAULT 0,
    dimensions JSONB DEFAULT '{}'::jsonb,
    sync_id TEXT,
    sync_timestamp TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'csv_upload',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_items_user_id ON inventory_items(user_id);
CREATE INDEX idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX idx_inventory_items_asin ON inventory_items(asin);
CREATE INDEX idx_inventory_items_store_id ON inventory_items(store_id);
CREATE INDEX idx_inventory_items_sync_id ON inventory_items(sync_id);
