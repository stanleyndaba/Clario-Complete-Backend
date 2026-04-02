-- Migration: 094_billing_invoice_payment_confirmation
-- Purpose: add explicit backend-confirmed payment audit fields for YOCO-link subscription invoices.

ALTER TABLE billing_invoices
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_confirmation_source TEXT
    CHECK (
      payment_confirmation_source IS NULL
      OR payment_confirmation_source IN ('manual_dashboard', 'manual_api', 'legacy_status_backfill')
    ),
  ADD COLUMN IF NOT EXISTS payment_confirmed_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_confirmation_note TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant_paid_at
  ON billing_invoices(tenant_id, paid_at DESC)
  WHERE paid_at IS NOT NULL;

UPDATE billing_invoices
SET
  paid_at = COALESCE(paid_at, invoice_date, created_at),
  payment_confirmation_source = COALESCE(payment_confirmation_source, 'legacy_status_backfill'),
  amount_charged_cents = COALESCE(amount_charged_cents, billing_amount_cents),
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'payment_confirmation',
    jsonb_build_object(
      'confirmed_at', COALESCE(paid_at, invoice_date, created_at),
      'source', COALESCE(payment_confirmation_source, 'legacy_status_backfill'),
      'confirmed_by_user_id', payment_confirmed_by_user_id,
      'note', payment_confirmation_note
    )
  )
WHERE invoice_model = 'subscription'
  AND status = 'paid'
  AND (
    paid_at IS NULL
    OR payment_confirmation_source IS NULL
    OR amount_charged_cents IS NULL
  );

COMMENT ON COLUMN billing_invoices.paid_at IS 'Explicit backend-confirmed paid timestamp for subscription invoices. YOCO link clicks alone must not populate this.';
COMMENT ON COLUMN billing_invoices.payment_confirmation_source IS 'How the invoice was explicitly marked paid: manual_dashboard, manual_api, or legacy_status_backfill.';
COMMENT ON COLUMN billing_invoices.payment_confirmed_by_user_id IS 'User ID that explicitly confirmed payment on the backend, when available.';
COMMENT ON COLUMN billing_invoices.payment_confirmation_note IS 'Optional operator note captured when payment was explicitly confirmed.';
