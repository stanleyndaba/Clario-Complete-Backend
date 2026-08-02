-- Recover Once: scoped one-time quote, checkout, and engagement records.

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_product_key_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_product_key_check
  CHECK (product_key IN ('recovery_workspace_activation', 'recovery_workspace_monthly', 'recover_once'));

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_payment_kind_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_payment_kind_check
  CHECK (payment_kind IS NULL OR payment_kind IN ('subscription_initial', 'subscription_renewal', 'recover_once'));

CREATE TABLE IF NOT EXISTS recover_once_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audit_run_id UUID NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
  amount_subunits INTEGER CHECK (amount_subunits IS NULL OR amount_subunits > 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'available',
      'accepted',
      'paid',
      'expired',
      'manual_review_required',
      'unavailable',
      'cancelled'
    )
  ),
  estimated_recoverable_subunits INTEGER NOT NULL DEFAULT 0,
  workload_score INTEGER NOT NULL DEFAULT 0,
  included_opportunity_count INTEGER NOT NULL DEFAULT 0,
  calculation JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope_hash TEXT NOT NULL,
  manual_review_reason TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  payment_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recover_once_quotes_tenant_audit
  ON recover_once_quotes(tenant_id, audit_run_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recover_once_quotes_active_scope
  ON recover_once_quotes(audit_run_id, scope_hash)
  WHERE status IN ('available', 'accepted', 'paid', 'manual_review_required');

CREATE UNIQUE INDEX IF NOT EXISTS idx_recover_once_quotes_payment_id
  ON recover_once_quotes(payment_id)
  WHERE payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recover_once_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audit_run_id UUID NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES recover_once_quotes(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'in_progress', 'completed', 'cancelled')),
  scope_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recover_once_engagements_quote_once
  ON recover_once_engagements(quote_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recover_once_engagements_payment_once
  ON recover_once_engagements(payment_id);

CREATE INDEX IF NOT EXISTS idx_recover_once_engagements_tenant
  ON recover_once_engagements(tenant_id, created_at DESC);
