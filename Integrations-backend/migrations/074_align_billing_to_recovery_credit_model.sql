-- Agent 9: Align billing to prepaid-credit + confirmed-recovery model

CREATE TABLE IF NOT EXISTS recovery_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'paypal',
  cycle_type TEXT NOT NULL DEFAULT 'priority_recovery_cycle',
  cycle_window_days INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_recovery_cycles_tenant_seller
  ON recovery_cycles(tenant_id, seller_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  recovery_cycle_id UUID REFERENCES recovery_cycles(id) ON DELETE SET NULL,
  billing_transaction_id UUID REFERENCES billing_transactions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'paypal',
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('credit_added', 'credit_applied')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
  external_payment_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_credit_ledger_tenant_seller
  ON billing_credit_ledger(tenant_id, seller_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_credit_ledger_external_payment
  ON billing_credit_ledger(external_payment_id, transaction_type)
  WHERE external_payment_id IS NOT NULL;

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS recovery_cycle_id UUID REFERENCES recovery_cycles(id) ON DELETE SET NULL;

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS credit_applied_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS amount_due_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS credit_balance_after_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS paypal_invoice_id TEXT;

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'paypal';

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'success_fee'
  CHECK (billing_type IN ('success_fee', 'priority_prepaid_credit'));

ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS external_payment_id TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_transactions_billing_status_check'
  ) THEN
    ALTER TABLE billing_transactions DROP CONSTRAINT billing_transactions_billing_status_check;
  END IF;
END $$;

ALTER TABLE billing_transactions
  ADD CONSTRAINT billing_transactions_billing_status_check
  CHECK (billing_status IN ('pending', 'sent', 'charged', 'credited', 'failed', 'refunded'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dispute_cases_billing_status_check'
  ) THEN
    ALTER TABLE dispute_cases DROP CONSTRAINT dispute_cases_billing_status_check;
  END IF;
END $$;

ALTER TABLE dispute_cases
  ADD CONSTRAINT dispute_cases_billing_status_check
  CHECK (billing_status IN ('pending', 'sent', 'charged', 'credited', 'failed', 'refunded'));

CREATE INDEX IF NOT EXISTS idx_billing_transactions_tenant_id
  ON billing_transactions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_recovery_cycle_id
  ON billing_transactions(recovery_cycle_id);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_paypal_invoice_id
  ON billing_transactions(paypal_invoice_id);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_external_payment_id
  ON billing_transactions(external_payment_id);
