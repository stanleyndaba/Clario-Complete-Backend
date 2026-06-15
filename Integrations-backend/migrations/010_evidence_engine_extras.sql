-- Migration: Evidence Engine DB layer extras (triggers, constraints, indexes, RLS updates)

-- Helper function for updated_at (idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $fn$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- Triggers for updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_evidence_sources_updated_at'
  ) THEN
    CREATE TRIGGER trg_evidence_sources_updated_at
      BEFORE UPDATE ON evidence_sources
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_evidence_documents_updated_at'
  ) THEN
    CREATE TRIGGER trg_evidence_documents_updated_at
      BEFORE UPDATE ON evidence_documents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_smart_prompts_updated_at'
  ) THEN
    ALTER TABLE smart_prompts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE TRIGGER trg_smart_prompts_updated_at
      BEFORE UPDATE ON smart_prompts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END$$;

-- Constraints
ALTER TABLE evidence_line_items
  ADD CONSTRAINT evidence_line_items_sku_or_asin_chk
  CHECK (sku IS NOT NULL OR asin IS NOT NULL);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_evidence_documents_seller_date ON evidence_documents(seller_id, document_date);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_invoice_number ON evidence_documents(invoice_number);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_supplier_name ON evidence_documents(supplier_name);

-- Prevent duplicate links between same dispute and document
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_evidence_link ON dispute_evidence_links(dispute_case_id, evidence_document_id);

-- RLS update policies (allow owner updates where appropriate)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'evidence_line_items_owner_update'
  ) THEN
    CREATE POLICY evidence_line_items_owner_update ON evidence_line_items FOR UPDATE USING (auth.uid()::text = seller_id);
  END IF;
END$$;



