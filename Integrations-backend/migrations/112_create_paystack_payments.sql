CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  reference text NOT NULL UNIQUE,
  access_code text,
  authorization_url text,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  audit_run_id uuid REFERENCES audit_runs(id) ON DELETE SET NULL,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  product_key text NOT NULL,
  amount_subunits integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL,
  provider_transaction_id text,
  provider_status text,
  paid_at timestamptz,
  verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_provider_check CHECK (provider IN ('paystack')),
  CONSTRAINT payments_status_check CHECK (
    status IN ('initialized', 'redirected', 'pending', 'paid', 'failed', 'abandoned', 'cancelled')
  ),
  CONSTRAINT payments_product_key_check CHECK (product_key IN ('recovery_workspace_activation')),
  CONSTRAINT payments_currency_check CHECK (currency IN ('ZAR')),
  CONSTRAINT payments_amount_positive_check CHECK (amount_subunits > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference_unique ON payments(reference);
CREATE INDEX IF NOT EXISTS idx_payments_user_created_at ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_created_at ON payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_audit_run_id ON payments(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_payments_status_created_at ON payments(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_paid_activation_once
  ON payments(audit_run_id)
  WHERE audit_run_id IS NOT NULL
    AND status = 'paid'
    AND product_key = 'recovery_workspace_activation';

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text,
  reference text,
  event_type text NOT NULL,
  signature_hash text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_webhook_events_provider_check CHECK (provider IN ('paystack')),
  CONSTRAINT payment_webhook_events_status_check CHECK (status IN ('received', 'processed', 'ignored', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_events_provider_event_id
  ON payment_webhook_events(provider, event_id)
  WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_events_provider_signature_hash
  ON payment_webhook_events(provider, signature_hash);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_reference ON payment_webhook_events(reference);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_status_created_at
  ON payment_webhook_events(status, created_at DESC);

ALTER TABLE audit_runs
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_runs_activated_by_payment_id
  ON audit_runs(activated_by_payment_id)
  WHERE activated_by_payment_id IS NOT NULL;

COMMENT ON TABLE payments IS 'Authoritative payment attempts and paid activation truth for Margin products.';
COMMENT ON TABLE payment_webhook_events IS 'Idempotent signed payment-provider webhook event ledger.';
