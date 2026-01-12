-- Migration 055: Product Costs and Price History Tables
-- For Agent 3 Reimbursement Underpayment Detection
-- Created: 2026-01-12

-- ============================================================================
-- 1. PRODUCT COSTS TABLE
-- Stores seller COGS (Cost of Goods Sold) per SKU
-- Source: manual input, uploaded invoices, or accounting integrations
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Product identifiers
    sku TEXT NOT NULL,
    asin TEXT,
    fnsku TEXT,
    product_name TEXT,
    
    -- Cost data
    cogs_value NUMERIC(12,2) NOT NULL,
    cost_currency TEXT DEFAULT 'USD',
    
    -- Source tracking
    source TEXT NOT NULL CHECK (source IN ('uploaded_invoice', 'manual_input', 'accounting_integration', 'estimated')),
    source_document_id UUID, -- FK to evidence_documents if from invoice
    source_reference TEXT, -- External reference (e.g., QuickBooks item ID)
    
    -- Validity period
    effective_date_start DATE,
    effective_date_end DATE,
    
    -- Confidence in the data
    confidence_score NUMERIC(3,2) DEFAULT 0.50 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    
    -- Audit timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    
    -- Ensure unique COGS per SKU per period
    UNIQUE(seller_id, sku, effective_date_start)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_product_costs_seller_id ON product_costs(seller_id);
CREATE INDEX IF NOT EXISTS idx_product_costs_tenant_id ON product_costs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_costs_sku ON product_costs(sku);
CREATE INDEX IF NOT EXISTS idx_product_costs_asin ON product_costs(asin);
CREATE INDEX IF NOT EXISTS idx_product_costs_fnsku ON product_costs(fnsku);
CREATE INDEX IF NOT EXISTS idx_product_costs_effective_dates ON product_costs(effective_date_start, effective_date_end);

COMMENT ON TABLE product_costs IS 'Stores seller COGS (Cost of Goods Sold) for reimbursement underpayment detection';

-- ============================================================================
-- 2. PRODUCT PRICE HISTORY TABLE
-- Stores rolling price metrics per SKU for fair market value calculation
-- Updated periodically from order history and Amazon pricing data
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Product identifiers
    sku TEXT NOT NULL,
    asin TEXT,
    fnsku TEXT,
    product_name TEXT,
    
    -- Rolling median prices (primary for fair value calculation)
    median_sale_price_30d NUMERIC(12,2),
    median_sale_price_90d NUMERIC(12,2),
    median_sale_price_180d NUMERIC(12,2),
    
    -- Average prices
    avg_sale_price_30d NUMERIC(12,2),
    avg_sale_price_90d NUMERIC(12,2),
    
    -- Price range
    min_sale_price_30d NUMERIC(12,2),
    max_sale_price_30d NUMERIC(12,2),
    
    -- Amazon listing prices
    buybox_price NUMERIC(12,2),
    list_price NUMERIC(12,2),
    
    -- Statistics for confidence calculations
    sample_count_30d INTEGER DEFAULT 0,
    sample_count_90d INTEGER DEFAULT 0,
    price_variance_30d NUMERIC(12,4), -- For outlier detection
    
    -- Metadata
    currency TEXT DEFAULT 'USD',
    last_order_date TIMESTAMPTZ,
    last_price_fetch TIMESTAMPTZ,
    
    -- Audit timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- One record per SKU per seller
    UNIQUE(seller_id, sku)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_product_price_history_seller_id ON product_price_history(seller_id);
CREATE INDEX IF NOT EXISTS idx_product_price_history_tenant_id ON product_price_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_price_history_sku ON product_price_history(sku);
CREATE INDEX IF NOT EXISTS idx_product_price_history_asin ON product_price_history(asin);
CREATE INDEX IF NOT EXISTS idx_product_price_history_updated ON product_price_history(updated_at);

COMMENT ON TABLE product_price_history IS 'Stores rolling price metrics for fair market value calculation in reimbursement detection';

-- ============================================================================
-- 3. REIMBURSEMENT ANALYSIS TABLE
-- Stores analysis results for each reimbursement event
-- Links reimbursements to expected values and detects underpayments
-- ============================================================================

CREATE TABLE IF NOT EXISTS reimbursement_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id TEXT NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Link to original reimbursement
    reimbursement_id TEXT, -- From settlements/financial events
    settlement_id TEXT,
    order_id TEXT,
    
    -- Product info
    sku TEXT,
    asin TEXT,
    fnsku TEXT,
    quantity INTEGER DEFAULT 1,
    
    -- Actual vs Expected
    actual_reimbursement NUMERIC(12,2) NOT NULL,
    expected_fair_value NUMERIC(12,2), -- Based on median sale price
    seller_cogs NUMERIC(12,2), -- From product_costs
    
    -- Calculated fields
    expected_floor NUMERIC(12,2), -- median * 0.75
    expected_ceiling NUMERIC(12,2), -- median * 1.05
    shortfall_amount NUMERIC(12,2), -- expected - actual (if positive = underpaid)
    cogs_gap NUMERIC(12,2), -- COGS - actual (if positive = below cost)
    
    -- Detection flags
    is_below_floor BOOLEAN DEFAULT FALSE,
    is_below_cogs BOOLEAN DEFAULT FALSE,
    is_statistical_outlier BOOLEAN DEFAULT FALSE,
    is_historically_underpaid BOOLEAN DEFAULT FALSE,
    
    -- Confidence scoring
    confidence_score NUMERIC(3,2) DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    confidence_factors JSONB DEFAULT '{}',
    
    -- Classification
    severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    recommended_action TEXT CHECK (recommended_action IN ('no_action', 'review', 'file_claim', 'escalate')),
    
    -- Status tracking
    status TEXT DEFAULT 'detected' CHECK (status IN ('detected', 'reviewed', 'claim_filed', 'resolved', 'dismissed')),
    detection_result_id UUID, -- Link to detection_results if claim generated
    
    -- Currency
    currency TEXT DEFAULT 'USD',
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_seller ON reimbursement_analysis(seller_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_tenant ON reimbursement_analysis(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_sku ON reimbursement_analysis(sku);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_status ON reimbursement_analysis(status);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_severity ON reimbursement_analysis(severity);
CREATE INDEX IF NOT EXISTS idx_reimbursement_analysis_shortfall ON reimbursement_analysis(shortfall_amount) WHERE shortfall_amount > 0;

COMMENT ON TABLE reimbursement_analysis IS 'Stores reimbursement underpayment analysis results for Agent 3 detection';

-- ============================================================================
-- 4. ENABLE RLS
-- ============================================================================

ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursement_analysis ENABLE ROW LEVEL SECURITY;

-- RLS Policies for product_costs
CREATE POLICY product_costs_tenant_isolation ON product_costs
    FOR ALL USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.current_tenant_id', true) IS NULL
    );

-- RLS Policies for product_price_history
CREATE POLICY product_price_history_tenant_isolation ON product_price_history
    FOR ALL USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.current_tenant_id', true) IS NULL
    );

-- RLS Policies for reimbursement_analysis
CREATE POLICY reimbursement_analysis_tenant_isolation ON reimbursement_analysis
    FOR ALL USING (
        tenant_id = current_setting('app.current_tenant_id', true)::uuid
        OR current_setting('app.current_tenant_id', true) IS NULL
    );

-- ============================================================================
-- 5. UPDATE TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_product_costs_updated_at
    BEFORE UPDATE ON product_costs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_product_price_history_updated_at
    BEFORE UPDATE ON product_price_history
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reimbursement_analysis_updated_at
    BEFORE UPDATE ON reimbursement_analysis
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
