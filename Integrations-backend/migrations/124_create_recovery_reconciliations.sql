-- Migration 124: Create recovery_reconciliations table for QuickBooks and Xero reconciliation
CREATE TABLE IF NOT EXISTS recovery_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  recovery_id UUID NOT NULL,
  provider VARCHAR(50) NOT NULL,
  provider_record_id VARCHAR(255),
  status VARCHAR(50) NOT NULL,
  expected_amount NUMERIC(12, 2) NOT NULL,
  matched_amount NUMERIC(12, 2),
  difference NUMERIC(12, 2),
  currency VARCHAR(10) DEFAULT 'USD',
  confidence_score NUMERIC(5, 4) DEFAULT 0.0,
  match_reasons JSONB DEFAULT '[]'::jsonb,
  transaction_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reconciled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_recovery_provider UNIQUE (recovery_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_recovery_reconciliations_tenant ON recovery_reconciliations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recovery_reconciliations_recovery ON recovery_reconciliations(recovery_id);
