-- Migration: normalized line items for evidence documents plus indexes

CREATE TABLE IF NOT EXISTS evidence_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
  sku TEXT,
  asin TEXT,
  quantity INTEGER,
  unit_cost DECIMAL(12,4),
  currency TEXT,
  document_date TIMESTAMPTZ
);

-- Useful selective indexes
CREATE INDEX IF NOT EXISTS idx_evidence_line_items_seller_sku_date ON evidence_line_items(seller_id, sku, document_date);
CREATE INDEX IF NOT EXISTS idx_evidence_line_items_seller_asin_date ON evidence_line_items(seller_id, asin, document_date);
CREATE INDEX IF NOT EXISTS idx_evidence_line_items_doc ON evidence_line_items(document_id);

-- RLS enable and policies
ALTER TABLE evidence_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_line_items_owner_select ON evidence_line_items FOR SELECT USING (auth.uid()::text = seller_id);
CREATE POLICY evidence_line_items_owner_insert ON evidence_line_items FOR INSERT WITH CHECK (auth.uid()::text = seller_id);


