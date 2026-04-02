-- Migration: 095_subscription_invoice_payment_references
-- Purpose: add backend-owned payment references for YOCO-linked subscription invoices.

ALTER TABLE billing_invoices
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

UPDATE billing_invoices
SET payment_reference = invoice_id
WHERE invoice_model = 'subscription'
  AND invoice_type = 'subscription_invoice'
  AND NULLIF(TRIM(COALESCE(payment_reference, '')), '') IS NULL
  AND NULLIF(TRIM(COALESCE(invoice_id, '')), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_invoices_subscription_payment_reference
  ON billing_invoices(payment_reference)
  WHERE invoice_model = 'subscription'
    AND invoice_type = 'subscription_invoice'
    AND payment_reference IS NOT NULL;

COMMENT ON COLUMN billing_invoices.payment_reference IS 'Stable backend-owned invoice payment reference for manual YOCO confirmation. Null means confirmation must fail closed.';
