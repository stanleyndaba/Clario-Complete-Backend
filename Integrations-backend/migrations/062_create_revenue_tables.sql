-- Migration: Create Revenue System Tables
-- Tables for reimbursement matching, commission invoicing, and payment methods

----------------------------------------------------------------------
-- 1. reimbursement_matches
--    Links Amazon reimbursement events/emails to Margin-filed dispute cases
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reimbursement_matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  store_id TEXT,
  dispute_case_id UUID REFERENCES dispute_cases(id) ON DELETE SET NULL,
  detection_result_id UUID REFERENCES detection_results(id) ON DELETE SET NULL,

  -- What Amazon paid
  amazon_reimbursement_amount DECIMAL(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  reimbursement_date TIMESTAMPTZ NOT NULL,

  -- How we found the match
  match_source TEXT NOT NULL DEFAULT 'gmail_email'
    CHECK (match_source IN ('gmail_email', 'csv_upload', 'manual', 'api')),
  match_confidence DECIMAL(3,2) NOT NULL DEFAULT 0.00
    CHECK (match_confidence >= 0 AND match_confidence <= 1),

  -- Source metadata (email id, subject, body snippet, case ref, etc.)
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'confirmed', 'disputed', 'invoiced', 'void')),

  -- Optional references extracted from the email / CSV
  amazon_case_id TEXT,
  amazon_order_id TEXT,
  asin TEXT,
  sku TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reimb_matches_seller ON reimbursement_matches(seller_id);
CREATE INDEX IF NOT EXISTS idx_reimb_matches_status ON reimbursement_matches(status);
CREATE INDEX IF NOT EXISTS idx_reimb_matches_dispute ON reimbursement_matches(dispute_case_id);
CREATE INDEX IF NOT EXISTS idx_reimb_matches_date ON reimbursement_matches(reimbursement_date);

----------------------------------------------------------------------
-- 2. margin_invoices
--    Commission invoices Margin sends to sellers (20 % of reimbursements)
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS margin_invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  store_id TEXT,

  invoice_number TEXT UNIQUE NOT NULL,  -- e.g. MRG-2026-0001

  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,

  -- Totals
  total_reimbursements DECIMAL(12,2) NOT NULL DEFAULT 0,
  commission_rate DECIMAL(5,4) NOT NULL DEFAULT 0.2000,  -- 20 %
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,

  -- Status
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending', 'sent', 'paid', 'disputed', 'void')),

  due_date TIMESTAMPTZ,
  dispute_window_ends TIMESTAMPTZ,   -- 24 hr window to dispute
  paid_at TIMESTAMPTZ,
  payment_method_id UUID,            -- FK to payment_methods if card-charged

  -- Breakdown of every matched reimbursement in this invoice
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_margin_inv_seller ON margin_invoices(seller_id);
CREATE INDEX IF NOT EXISTS idx_margin_inv_status ON margin_invoices(status);
CREATE INDEX IF NOT EXISTS idx_margin_inv_due ON margin_invoices(due_date);

----------------------------------------------------------------------
-- 3. payment_methods
--    Card-on-file for future auto-charge (no Stripe for now — just store
--    a masked reference; actual charging is Phase 2)
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,

  method_type TEXT NOT NULL DEFAULT 'card'
    CHECK (method_type IN ('card', 'bank_account', 'manual')),

  -- Masked display info only — never store raw card numbers
  card_brand TEXT,         -- visa, mastercard, amex …
  card_last_four TEXT,     -- 4242
  card_exp_month INT,
  card_exp_year INT,
  cardholder_name TEXT,
  billing_email TEXT,

  -- For future gateway integration
  external_token TEXT,     -- tokenised reference (Stripe PM id, etc.)
  gateway TEXT,            -- 'stripe', 'paystack', 'manual', etc.

  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'removed')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_methods_seller ON payment_methods(seller_id);
CREATE INDEX IF NOT EXISTS idx_pay_methods_default ON payment_methods(is_default);

----------------------------------------------------------------------
-- Triggers
----------------------------------------------------------------------
CREATE TRIGGER update_reimbursement_matches_updated_at
  BEFORE UPDATE ON reimbursement_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_margin_invoices_updated_at
  BEFORE UPDATE ON margin_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

----------------------------------------------------------------------
-- Comments
----------------------------------------------------------------------
COMMENT ON TABLE reimbursement_matches IS 'Maps Amazon reimbursement events to Margin-filed dispute cases';
COMMENT ON TABLE margin_invoices IS 'Commission invoices (20%) that Margin issues to sellers';
COMMENT ON TABLE payment_methods IS 'Seller payment methods (card on file) for future auto-charge';
