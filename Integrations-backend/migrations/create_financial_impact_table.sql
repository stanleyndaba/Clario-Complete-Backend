-- Migration: Create financial_impact_events table
-- This table tracks the financial lifecycle of each detection

CREATE TABLE IF NOT EXISTS financial_impact_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    detection_id TEXT UNIQUE NOT NULL, -- Logical ID from Agent 3
    claim_id TEXT,                    -- Amazon Case ID (when filed)
    user_id UUID NOT NULL,            -- The seller
    tenant_id UUID,                   -- Multi-tenant context
    status TEXT NOT NULL,             -- detected, filed, approved, paid, failed
    estimated_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    confirmed_amount DECIMAL(12, 2),
    currency TEXT NOT NULL DEFAULT 'USD',
    confidence DECIMAL(4, 3) NOT NULL DEFAULT 1.0,
    anomaly_type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_financial_impact_user ON financial_impact_events(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_impact_status ON financial_impact_events(status);

-- Ensure RLS is enabled but accessible to service role
ALTER TABLE financial_impact_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for service role" ON financial_impact_events
    FOR ALL USING (true);
