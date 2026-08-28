-- Migration 136: Persist public Talk-to-Sales assessment leads
-- The POST endpoint is public by design; the read endpoint is platform-admin protected.
CREATE TABLE IF NOT EXISTS sales_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    annual_gmv TEXT NOT NULL,
    accounts_marketplaces TEXT NULL,
    catalogue_complexity TEXT NULL,
    current_process TEXT NULL,
    objective TEXT NULL,
    notes TEXT NULL,
    source_page TEXT NOT NULL DEFAULT '/sales',
    status TEXT NOT NULL DEFAULT 'new',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sales_leads_status_check CHECK (status IN ('new', 'reviewing', 'qualified', 'not_qualified', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_sales_leads_created_at
    ON sales_leads (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_leads_status_created_at
    ON sales_leads (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_leads_email
    ON sales_leads (lower(email));
