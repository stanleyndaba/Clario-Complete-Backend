CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  initial_audit_run_id uuid REFERENCES audit_runs(id) ON DELETE SET NULL,
  product_key text NOT NULL,
  provider_customer_code text,
  provider_subscription_code text,
  provider_plan_code text NOT NULL,
  provider_email_token text,
  status text NOT NULL,
  amount_subunits integer NOT NULL,
  currency text NOT NULL,
  billing_interval text NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_payment_at timestamptz,
  grace_expires_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancel_requested_at timestamptz,
  cancelled_at timestamptz,
  ended_at timestamptz,
  latest_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_subscriptions_provider_check CHECK (provider IN ('paystack')),
  CONSTRAINT billing_subscriptions_status_check CHECK (
    status IN ('pending', 'active', 'non_renewing', 'past_due', 'suspended', 'cancelled', 'expired')
  ),
  CONSTRAINT billing_subscriptions_product_key_check CHECK (product_key IN ('recovery_workspace_monthly')),
  CONSTRAINT billing_subscriptions_currency_upper_check CHECK (currency = upper(currency)),
  CONSTRAINT billing_subscriptions_interval_check CHECK (billing_interval IN ('monthly')),
  CONSTRAINT billing_subscriptions_amount_positive_check CHECK (amount_subunits > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_provider_code
  ON billing_subscriptions(provider, provider_subscription_code)
  WHERE provider_subscription_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_one_open_per_tenant
  ON billing_subscriptions(provider, tenant_id, product_key)
  WHERE status IN ('pending', 'active', 'non_renewing', 'past_due', 'suspended');

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_tenant_status
  ON billing_subscriptions(tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_next_payment
  ON billing_subscriptions(status, next_payment_at)
  WHERE next_payment_at IS NOT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS billing_subscription_id uuid REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_invoice_code text,
  ADD COLUMN IF NOT EXISTS billing_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS billing_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS payment_kind text;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_product_key_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_product_key_check
  CHECK (product_key IN ('recovery_workspace_activation', 'recovery_workspace_monthly'));

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_payment_kind_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_payment_kind_check
  CHECK (payment_kind IS NULL OR payment_kind IN ('subscription_initial', 'subscription_renewal'));

CREATE INDEX IF NOT EXISTS idx_payments_billing_subscription_id
  ON payments(billing_subscription_id, created_at DESC)
  WHERE billing_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_invoice_code
  ON payments(provider, provider_invoice_code)
  WHERE provider_invoice_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  billing_subscription_id uuid REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_invoice_code text,
  provider_transaction_reference text,
  amount_subunits integer,
  currency text,
  status text NOT NULL,
  due_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  provider_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_subscription_invoices_provider_check CHECK (provider IN ('paystack')),
  CONSTRAINT billing_subscription_invoices_status_check CHECK (
    status IN ('pending', 'paid', 'failed', 'cancelled', 'unknown')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscription_invoices_provider_code
  ON billing_subscription_invoices(provider, provider_invoice_code)
  WHERE provider_invoice_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_subscription_invoices_subscription
  ON billing_subscription_invoices(billing_subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_subscription_invoices_tenant_status
  ON billing_subscription_invoices(tenant_id, status, created_at DESC);

COMMENT ON TABLE billing_subscriptions IS 'Provider-backed recurring Recovery Workspace subscription truth. Entitlements must derive from this table.';
COMMENT ON COLUMN billing_subscriptions.provider_email_token IS 'Paystack subscription management token. Do not expose to clients or logs.';
COMMENT ON TABLE billing_subscription_invoices IS 'Provider invoice lifecycle records for recurring Paystack subscriptions.';
