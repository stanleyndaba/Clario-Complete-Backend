-- Phase 2: Continuous Data Sync - Database Schema
-- Creates tables for Orders, Shipments, Returns, and Settlements

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ORDERS TABLE
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    order_id VARCHAR(100) NOT NULL,
    seller_id VARCHAR(100),
    marketplace_id VARCHAR(50),
    order_date TIMESTAMP WITH TIME ZONE,
    shipment_date TIMESTAMP WITH TIME ZONE,
    fulfillment_channel VARCHAR(50), -- FBA, FBM
    order_status VARCHAR(50), -- Pending, Shipped, Delivered, Cancelled, etc.
    items JSONB, -- Array of order items with SKU, ASIN, quantity, price
    quantities JSONB, -- Summary of quantities per item
    total_amount DECIMAL(10, 2),
    currency VARCHAR(10) DEFAULT 'USD',
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional order metadata
    source_report VARCHAR(100), -- Source report type if from FBA reports
    sync_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_sandbox BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, order_id)
);

-- 2. SHIPMENTS TABLE
CREATE TABLE IF NOT EXISTS shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    shipment_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100), -- Links to orders table
    tracking_number VARCHAR(200),
    shipped_date TIMESTAMP WITH TIME ZONE,
    received_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50), -- in_transit, received, lost, damaged, delayed
    carrier VARCHAR(100),
    warehouse_location VARCHAR(100),
    items JSONB, -- Array of items in shipment (SKU, ASIN, quantity)
    expected_quantity INTEGER,
    received_quantity INTEGER,
    missing_quantity INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    source_report VARCHAR(100),
    sync_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_sandbox BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, shipment_id)
);

-- 3. RETURNS TABLE
CREATE TABLE IF NOT EXISTS returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    return_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100), -- Links to orders table
    reason VARCHAR(200),
    returned_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50), -- pending, processed, refunded, rejected
    refund_amount DECIMAL(10, 2),
    currency VARCHAR(10) DEFAULT 'USD',
    items JSONB, -- Array of returned items (SKU, ASIN, quantity, refund_amount)
    is_partial BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    source_report VARCHAR(100),
    sync_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_sandbox BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, return_id)
);

-- 4. SETTLEMENTS TABLE (Enhanced Financial Events)
CREATE TABLE IF NOT EXISTS settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    settlement_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100), -- Links to orders table
    transaction_type VARCHAR(50), -- fee, refund, reimbursement, adjustment, payment
    amount DECIMAL(10, 2),
    fees DECIMAL(10, 2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    settlement_date TIMESTAMP WITH TIME ZONE,
    fee_breakdown JSONB, -- Detailed breakdown of fees (FBA, referral, etc.)
    metadata JSONB DEFAULT '{}'::jsonb,
    source_report VARCHAR(100),
    sync_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_sandbox BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, settlement_id, transaction_type)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_marketplace_id ON orders(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_orders_sync_timestamp ON orders(sync_timestamp);

CREATE INDEX IF NOT EXISTS idx_shipments_user_id ON shipments(user_id);
CREATE INDEX IF NOT EXISTS idx_shipments_shipment_id ON shipments(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_sync_timestamp ON shipments(sync_timestamp);

CREATE INDEX IF NOT EXISTS idx_returns_user_id ON returns(user_id);
CREATE INDEX IF NOT EXISTS idx_returns_return_id ON returns(return_id);
CREATE INDEX IF NOT EXISTS idx_returns_order_id ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_sync_timestamp ON returns(sync_timestamp);

CREATE INDEX IF NOT EXISTS idx_settlements_user_id ON settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_settlement_id ON settlements(settlement_id);
CREATE INDEX IF NOT EXISTS idx_settlements_order_id ON settlements(order_id);
CREATE INDEX IF NOT EXISTS idx_settlements_transaction_type ON settlements(transaction_type);
CREATE INDEX IF NOT EXISTS idx_settlements_settlement_date ON settlements(settlement_date);
CREATE INDEX IF NOT EXISTS idx_settlements_sync_timestamp ON settlements(sync_timestamp);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_orders_items_gin ON orders USING GIN (items);
CREATE INDEX IF NOT EXISTS idx_shipments_items_gin ON shipments USING GIN (items);
CREATE INDEX IF NOT EXISTS idx_returns_items_gin ON returns USING GIN (items);
CREATE INDEX IF NOT EXISTS idx_settlements_fee_breakdown_gin ON settlements USING GIN (fee_breakdown);

-- Add comments
COMMENT ON TABLE orders IS 'Amazon orders data synced from SP-API';
COMMENT ON TABLE shipments IS 'FBA shipment data synced from SP-API reports';
COMMENT ON TABLE returns IS 'Customer returns data synced from SP-API reports';
COMMENT ON TABLE settlements IS 'Financial settlements and fee data synced from SP-API';

COMMENT ON COLUMN orders.items IS 'Array of order items: [{sku, asin, quantity, price}]';
COMMENT ON COLUMN shipments.items IS 'Array of shipment items: [{sku, asin, quantity}]';
COMMENT ON COLUMN returns.items IS 'Array of returned items: [{sku, asin, quantity, refund_amount}]';
COMMENT ON COLUMN settlements.fee_breakdown IS 'Detailed fee breakdown: {fba_fee, referral_fee, shipping_fee, etc.}';

