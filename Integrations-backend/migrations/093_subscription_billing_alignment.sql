-- Migration: 093_subscription_billing_alignment
-- Purpose: align active billing to flat subscription pricing with a 60-day keep-100% promo.

CREATE TABLE IF NOT EXISTS tenant_billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT,
  billing_model TEXT NOT NULL DEFAULT 'flat_subscription'
    CHECK (billing_model IN ('flat_subscription')),
  plan_tier TEXT NOT NULL
    CHECK (plan_tier IN ('starter', 'pro', 'enterprise')),
  billing_interval TEXT NOT NULL
    CHECK (billing_interval IN ('monthly', 'annual')),
  monthly_price_cents INTEGER NOT NULL CHECK (monthly_price_cents >= 0),
  annual_monthly_equivalent_price_cents INTEGER NOT NULL CHECK (annual_monthly_equivalent_price_cents >= 0),
  billing_amount_cents INTEGER NOT NULL CHECK (billing_amount_cents >= 0),
  billing_currency TEXT NOT NULL DEFAULT 'USD',
  promo_start_at TIMESTAMPTZ,
  promo_end_at TIMESTAMPTZ,
  promo_type TEXT
    CHECK (promo_type IS NULL OR promo_type IN ('keep_100_percent_recoveries_60_days')),
  subscription_status TEXT NOT NULL
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'not_started')),
  current_period_start_at TIMESTAMPTZ,
  current_period_end_at TIMESTAMPTZ,
  next_billing_date TIMESTAMPTZ,
  billing_provider TEXT
    CHECK (billing_provider IS NULL OR billing_provider IN ('yoco')),
  billing_customer_id TEXT,
  billing_subscription_id TEXT,
  legacy_recovery_billing_disabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_billing_subscriptions_status
  ON tenant_billing_subscriptions(subscription_status, next_billing_date);

CREATE INDEX IF NOT EXISTS idx_tenant_billing_subscriptions_user
  ON tenant_billing_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id TEXT NOT NULL UNIQUE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT,
  subscription_id UUID REFERENCES tenant_billing_subscriptions(id) ON DELETE SET NULL,
  invoice_type TEXT NOT NULL DEFAULT 'subscription_invoice'
    CHECK (invoice_type IN ('subscription_invoice', 'legacy_recovery_fee_invoice')),
  invoice_model TEXT NOT NULL DEFAULT 'subscription'
    CHECK (invoice_model IN ('subscription', 'legacy_recovery_fee')),
  billing_model TEXT NOT NULL DEFAULT 'flat_subscription'
    CHECK (billing_model IN ('flat_subscription', 'legacy_recovery_fee')),
  plan_tier TEXT
    CHECK (plan_tier IS NULL OR plan_tier IN ('starter', 'pro', 'enterprise')),
  billing_interval TEXT
    CHECK (billing_interval IS NULL OR billing_interval IN ('monthly', 'annual')),
  billing_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (billing_amount_cents >= 0),
  amount_charged_cents INTEGER CHECK (amount_charged_cents IS NULL OR amount_charged_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_period_start TIMESTAMPTZ,
  billing_period_end TIMESTAMPTZ,
  invoice_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  subscription_status_snapshot TEXT,
  promo_type TEXT
    CHECK (promo_type IS NULL OR promo_type IN ('keep_100_percent_recoveries_60_days')),
  promo_note TEXT,
  provider TEXT,
  provider_invoice_id TEXT,
  provider_charge_id TEXT,
  payment_provider TEXT
    CHECK (payment_provider IS NULL OR payment_provider IN ('yoco')),
  payment_link_key TEXT,
  payment_link_url TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('draft', 'pending', 'scheduled', 'pending_payment_method', 'sent', 'paid', 'failed', 'void', 'legacy')),
  legacy_source_transaction_id UUID REFERENCES billing_transactions(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant_invoice_date
  ON billing_invoices(tenant_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_user_status
  ON billing_invoices(user_id, status, invoice_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_invoices_subscription_period
  ON billing_invoices(subscription_id, billing_period_start, billing_period_end)
  WHERE invoice_model = 'subscription'
    AND subscription_id IS NOT NULL
    AND billing_period_start IS NOT NULL
    AND billing_period_end IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS update_tenant_billing_subscriptions_updated_at ON tenant_billing_subscriptions;
    CREATE TRIGGER update_tenant_billing_subscriptions_updated_at
      BEFORE UPDATE ON tenant_billing_subscriptions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_billing_invoices_updated_at ON billing_invoices;
    CREATE TRIGGER update_billing_invoices_updated_at
      BEFORE UPDATE ON billing_invoices
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

INSERT INTO tenant_billing_subscriptions (
  tenant_id,
  user_id,
  plan_tier,
  billing_interval,
  monthly_price_cents,
  annual_monthly_equivalent_price_cents,
  billing_amount_cents,
  billing_currency,
  promo_start_at,
  promo_end_at,
  promo_type,
  subscription_status,
  current_period_start_at,
  current_period_end_at,
  next_billing_date,
  billing_provider,
  billing_customer_id,
  billing_subscription_id,
  metadata
)
SELECT
  t.id,
  (
    SELECT tm.user_id::text
    FROM tenant_memberships tm
    WHERE tm.tenant_id = t.id
      AND tm.deleted_at IS NULL
      AND tm.is_active = TRUE
    ORDER BY CASE tm.role
      WHEN 'owner' THEN 0
      WHEN 'admin' THEN 1
      WHEN 'member' THEN 2
      ELSE 3
    END, tm.created_at ASC
    LIMIT 1
  ) AS user_id,
  CASE t.plan
    WHEN 'starter' THEN 'starter'
    WHEN 'professional' THEN 'pro'
    WHEN 'enterprise' THEN 'enterprise'
    ELSE NULL
  END AS plan_tier,
  CASE
    WHEN LOWER(COALESCE(t.metadata->>'billing_interval', t.settings->>'billing_interval', 'monthly')) = 'annual' THEN 'annual'
    ELSE 'monthly'
  END AS billing_interval,
  CASE t.plan
    WHEN 'starter' THEN 4900
    WHEN 'professional' THEN 9900
    WHEN 'enterprise' THEN 19900
    ELSE NULL
  END AS monthly_price_cents,
  CASE t.plan
    WHEN 'starter' THEN 3900
    WHEN 'professional' THEN 7900
    WHEN 'enterprise' THEN 15900
    ELSE NULL
  END AS annual_monthly_equivalent_price_cents,
  CASE
    WHEN LOWER(COALESCE(t.metadata->>'billing_interval', t.settings->>'billing_interval', 'monthly')) = 'annual' THEN
      CASE t.plan
        WHEN 'starter' THEN 46800
        WHEN 'professional' THEN 94800
        WHEN 'enterprise' THEN 190800
        ELSE NULL
      END
    ELSE
      CASE t.plan
        WHEN 'starter' THEN 4900
        WHEN 'professional' THEN 9900
        WHEN 'enterprise' THEN 19900
        ELSE NULL
      END
  END AS billing_amount_cents,
  'USD' AS billing_currency,
  t.created_at,
  t.created_at + INTERVAL '60 days',
  'keep_100_percent_recoveries_60_days',
  CASE t.status
    WHEN 'trialing' THEN 'trialing'
    WHEN 'active' THEN 'active'
    WHEN 'suspended' THEN 'past_due'
    WHEN 'read_only' THEN 'past_due'
    WHEN 'canceled' THEN 'canceled'
    WHEN 'deleted' THEN 'canceled'
    ELSE 'incomplete'
  END AS subscription_status,
  NULL,
  NULL,
  CASE
    WHEN t.status = 'trialing' AND t.trial_ends_at IS NOT NULL THEN t.trial_ends_at
    ELSE NULL
  END AS next_billing_date,
  CASE
    WHEN t.plan IN ('starter', 'professional', 'enterprise') THEN 'yoco'
    ELSE NULL
  END AS billing_provider,
  NULL AS billing_customer_id,
  NULL AS billing_subscription_id,
  jsonb_build_object(
    'backfilled_from_tenants_table', TRUE,
    'legacy_plan_value', t.plan,
    'legacy_stripe_customer_id', t.stripe_customer_id,
    'legacy_stripe_subscription_id', t.stripe_subscription_id
  )
FROM tenants t
WHERE t.deleted_at IS NULL
  AND t.plan IN ('starter', 'professional', 'enterprise')
ON CONFLICT (tenant_id) DO NOTHING;

COMMENT ON TABLE tenant_billing_subscriptions IS 'Authoritative active subscription billing truth for Margin flat-plan billing.';
COMMENT ON TABLE billing_invoices IS 'Authoritative subscription invoice records. Active subscription invoices can attach YOCO checkout links. Legacy recovery-fee billing should not create new rows here.';
COMMENT ON TABLE billing_transactions IS 'Legacy recovery-fee billing transactions retained only for historical compatibility after subscription migration.';
COMMENT ON COLUMN tenant_billing_subscriptions.promo_type IS 'Current promo truth. Margin sellers keep 100% of recoveries for the first 60 days.';
COMMENT ON COLUMN tenant_billing_subscriptions.legacy_recovery_billing_disabled_at IS 'When legacy recovery-triggered billing was disabled for this tenant subscription record.';
COMMENT ON COLUMN billing_invoices.invoice_model IS 'subscription for active flat-plan invoices; legacy_recovery_fee for historical projections only.';
COMMENT ON COLUMN billing_invoices.invoice_type IS 'subscription_invoice for active YOCO-backed invoice truth; legacy_recovery_fee_invoice for historical invoice projections only.';
COMMENT ON COLUMN billing_invoices.payment_link_key IS 'Canonical YOCO plan/interval key such as starter_monthly or pro_annual.';
COMMENT ON COLUMN billing_invoices.payment_link_url IS 'Backend-owned YOCO checkout URL resolved from plan tier and billing interval. Null when mapping is unavailable.';
