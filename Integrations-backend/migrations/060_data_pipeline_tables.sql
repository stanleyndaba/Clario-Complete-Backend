-- ============================================================================
-- Migration 060: Data Pipeline Tables
-- 
-- Creates the three missing tables required by the data pipeline services:
--   1. product_catalog   — fed by catalogSyncService.ts
--   2. inventory_ledger  — fed by inventoryLedgerSyncService.ts
--   3. exchange_rates    — fed by claimValueCalculator.ts (live API cache)
--
-- Without these tables, upserts from the sync services fail silently
-- and detection algorithms run on empty data.
-- ============================================================================

-- ============================================================================
-- 1. PRODUCT CATALOG
-- Source: GET_MERCHANT_LISTINGS_ALL_DATA report via catalogSyncService.ts
-- Consumers: feeAlgorithms.ts, feeMisclassificationAlgorithm.ts
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_catalog (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    seller_id       TEXT NOT NULL,
    sku             TEXT NOT NULL,
    asin            TEXT NOT NULL,
    item_name       TEXT,
    price           NUMERIC(12, 2),
    quantity        INTEGER,
    fulfillment_channel TEXT,
    item_condition  TEXT,
    
    -- Dimensions (critical for fee calculations)
    length_cm       NUMERIC(10, 2),
    width_cm        NUMERIC(10, 2),
    height_cm       NUMERIC(10, 2),
    weight_kg       NUMERIC(10, 4),
    
    -- Classification
    category        TEXT,
    size_tier       TEXT,       -- STANDARD, OVERSIZE, SMALL_STANDARD, etc.
    
    -- Metadata
    last_synced     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint for upsert
    CONSTRAINT uq_product_catalog_seller_sku UNIQUE (seller_id, sku)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_product_catalog_seller 
    ON product_catalog (seller_id);
CREATE INDEX IF NOT EXISTS idx_product_catalog_asin 
    ON product_catalog (asin);
CREATE INDEX IF NOT EXISTS idx_product_catalog_seller_asin 
    ON product_catalog (seller_id, asin);

COMMENT ON TABLE product_catalog IS 
    'Product catalog synced from Amazon SP-API. Required by fee detection algorithms for dimension/weight/size-tier verification.';

-- ============================================================================
-- 2. INVENTORY LEDGER
-- Source: GET_LEDGER_DETAIL_VIEW_DATA report via inventoryLedgerSyncService.ts
-- Consumers: Lost inventory detection, damaged inventory detection
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_ledger (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    seller_id           TEXT NOT NULL,
    event_date          TIMESTAMPTZ NOT NULL,
    fnsku               TEXT NOT NULL,
    asin                TEXT,
    sku                 TEXT,
    title               TEXT,
    
    -- Event classification
    event_type          TEXT NOT NULL,      -- Receipts, Shipments, CustomerReturns, Adjustments, etc.
    reference_id        TEXT,               -- Shipment ID, Order ID, Adjustment ID
    quantity            INTEGER NOT NULL,   -- Positive = in, Negative = out
    
    -- Location & disposition
    fulfillment_center  TEXT,               -- PHX7, BFI4, etc.
    disposition         TEXT,               -- SELLABLE, DEFECTIVE, CUSTOMER_DAMAGED, etc.
    reason_code         TEXT,               -- Damage reason, adjustment reason
    country             TEXT,
    
    -- Metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Composite unique constraint for dedup (same event won't be inserted twice)
    CONSTRAINT uq_inventory_ledger_event 
        UNIQUE (seller_id, event_date, fnsku, event_type, reference_id)
);

-- Indexes for detection algorithm queries
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_seller 
    ON inventory_ledger (seller_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_seller_fnsku 
    ON inventory_ledger (seller_id, fnsku);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_seller_date 
    ON inventory_ledger (seller_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_event_type 
    ON inventory_ledger (event_type);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_disposition 
    ON inventory_ledger (disposition);

COMMENT ON TABLE inventory_ledger IS 
    'Historical inventory events from Amazon FBA. Required by lost/damaged inventory detection algorithms.';

-- ============================================================================
-- 3. EXCHANGE RATES
-- Source: Live API (open.er-api.com) cached by claimValueCalculator.ts
-- Consumers: claimValueCalculator.ts for international seller claim valuation
-- ============================================================================
CREATE TABLE IF NOT EXISTS exchange_rates (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    from_currency   TEXT NOT NULL,          -- EUR, GBP, CAD, etc.
    to_currency     TEXT NOT NULL,          -- USD (target)
    rate_date       DATE NOT NULL,          -- Date the rate applies to
    rate            NUMERIC(18, 8) NOT NULL,-- The exchange rate
    source          TEXT,                   -- 'live_api', 'manual', 'fallback'
    fetched_at      TIMESTAMPTZ,            -- When the rate was fetched
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint for upsert (one rate per currency pair per day)
    CONSTRAINT uq_exchange_rates_pair_date 
        UNIQUE (from_currency, to_currency, rate_date)
);

-- Indexes for rate lookups
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup 
    ON exchange_rates (from_currency, to_currency, rate_date DESC);

COMMENT ON TABLE exchange_rates IS 
    'Cached exchange rates for international claim valuation. Populated by live API, prevents using stale hardcoded rates.';

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY (RLS) for multi-tenant safety
-- ============================================================================
ALTER TABLE product_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

-- Product catalog: users can only see their own products
CREATE POLICY product_catalog_seller_policy ON product_catalog
    FOR ALL USING (seller_id = current_setting('app.current_user_id', true));

-- Inventory ledger: users can only see their own events
CREATE POLICY inventory_ledger_seller_policy ON inventory_ledger
    FOR ALL USING (seller_id = current_setting('app.current_user_id', true));

-- Exchange rates: all users can read (rates are shared), only service can write
CREATE POLICY exchange_rates_read_policy ON exchange_rates
    FOR SELECT USING (true);

-- ============================================================================
-- DONE
-- ============================================================================
