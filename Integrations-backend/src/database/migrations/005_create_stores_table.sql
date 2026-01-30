-- Migration 005: Create Stores Table and Store-Based Isolation
-- Introduces the "Store" entity as the primary control plane for multi-entity operations.

-- 1. Create STORES table
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    marketplace VARCHAR(50) NOT NULL, -- e.g., 'amazon_us', 'amazon_eu', 'shopify'
    seller_id VARCHAR(100), -- Platform-specific ID (e.g. Amazon Merchant ID)
    is_active BOOLEAN DEFAULT true,
    automation_enabled BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(tenant_id, seller_id, marketplace)
);

-- 2. Add store_id to operational tables
DO $$ 
BEGIN 
    -- Column additions with default NULL initially to avoid locking large tables
    -- In a real prod environment, we would do this in stages
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='store_id') THEN
        ALTER TABLE orders ADD COLUMN store_id UUID REFERENCES stores(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='shipments' AND column_name='store_id') THEN
        ALTER TABLE shipments ADD COLUMN store_id UUID REFERENCES stores(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='returns' AND column_name='store_id') THEN
        ALTER TABLE returns ADD COLUMN store_id UUID REFERENCES stores(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settlements' AND column_name='store_id') THEN
        ALTER TABLE settlements ADD COLUMN store_id UUID REFERENCES stores(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dispute_cases' AND column_name='store_id') THEN
        ALTER TABLE dispute_cases ADD COLUMN store_id UUID REFERENCES stores(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='detection_results' AND column_name='store_id') THEN
        ALTER TABLE detection_results ADD COLUMN store_id UUID REFERENCES stores(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sync_progress' AND column_name='store_id') THEN
        ALTER TABLE sync_progress ADD COLUMN store_id UUID REFERENCES stores(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tokens' AND column_name='store_id') THEN
        ALTER TABLE tokens ADD COLUMN store_id UUID REFERENCES stores(id);
    END IF;
END $$;

-- 3. Create indexes for store-scoped queries
CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_shipments_store_id ON shipments(store_id);
CREATE INDEX IF NOT EXISTS idx_returns_store_id ON returns(store_id);
CREATE INDEX IF NOT EXISTS idx_settlements_store_id ON settlements(store_id);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_store_id ON dispute_cases(store_id);
CREATE INDEX IF NOT EXISTS idx_detection_results_store_id ON detection_results(store_id);

-- 4. Audit Log Support
COMMENT ON TABLE stores IS 'Hard boundary for data, automation, and financial isolation.';
