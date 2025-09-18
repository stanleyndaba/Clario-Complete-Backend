-- Migration: Evidence Engine core tables

-- Source connections (email, cloud storage)
CREATE TABLE IF NOT EXISTS evidence_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail','outlook','dropbox','gdrive','onedrive','s3','other')),
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','disconnected','error')),
  display_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ingested documents with extracted fields
CREATE TABLE IF NOT EXISTS evidence_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  source_id UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('invoice','shipping','po','other')),
  supplier_name TEXT,
  invoice_number TEXT,
  purchase_order_number TEXT,
  document_date TIMESTAMPTZ,
  currency TEXT,
  total_amount DECIMAL(12,2),
  file_url TEXT, -- link in Supabase Storage or external
  raw_text TEXT,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb, -- structured: items: [{sku, asin, quantity, unit_cost}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link evidence to disputes
CREATE TABLE IF NOT EXISTS dispute_evidence_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  evidence_document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
  relevance_score NUMERIC(4,3),
  matched_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Proof packets (generated PDF bundles)
CREATE TABLE IF NOT EXISTS proof_packets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  packet_url TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Smart prompts when ambiguity exists
CREATE TABLE IF NOT EXISTS smart_prompts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed','expired')),
  prompt_type TEXT NOT NULL DEFAULT 'evidence_selection',
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{id, label, evidence_document_id}]
  selected_option_id TEXT,
  related_dispute_id UUID REFERENCES dispute_cases(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  answered_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_evidence_sources_seller ON evidence_sources(seller_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_seller ON evidence_documents(seller_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_doc_date ON evidence_documents(document_date);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_dispute ON dispute_evidence_links(dispute_case_id);
CREATE INDEX IF NOT EXISTS idx_proof_packets_dispute ON proof_packets(dispute_case_id);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_seller ON smart_prompts(seller_id);

-- RLS enable
ALTER TABLE evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE smart_prompts ENABLE ROW LEVEL SECURITY;

-- RLS policies (seller scoped)
CREATE POLICY evidence_sources_owner_select ON evidence_sources FOR SELECT USING (auth.uid()::text = seller_id);
CREATE POLICY evidence_sources_owner_insert ON evidence_sources FOR INSERT WITH CHECK (auth.uid()::text = seller_id);
CREATE POLICY evidence_sources_owner_update ON evidence_sources FOR UPDATE USING (auth.uid()::text = seller_id);

CREATE POLICY evidence_documents_owner_select ON evidence_documents FOR SELECT USING (auth.uid()::text = seller_id);
CREATE POLICY evidence_documents_owner_insert ON evidence_documents FOR INSERT WITH CHECK (auth.uid()::text = seller_id);
CREATE POLICY evidence_documents_owner_update ON evidence_documents FOR UPDATE USING (auth.uid()::text = seller_id);

CREATE POLICY dispute_evidence_links_dispute_scope ON dispute_evidence_links FOR SELECT USING (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = dispute_evidence_links.dispute_case_id AND d.seller_id = auth.uid()::text)
);
CREATE POLICY dispute_evidence_links_insert_scope ON dispute_evidence_links FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = dispute_evidence_links.dispute_case_id AND d.seller_id = auth.uid()::text)
);

CREATE POLICY proof_packets_owner_select ON proof_packets FOR SELECT USING (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = proof_packets.dispute_case_id AND d.seller_id = auth.uid()::text)
);
CREATE POLICY proof_packets_owner_insert ON proof_packets FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM dispute_cases d WHERE d.id = proof_packets.dispute_case_id AND d.seller_id = auth.uid()::text)
);

CREATE POLICY smart_prompts_owner_select ON smart_prompts FOR SELECT USING (auth.uid()::text = seller_id);
CREATE POLICY smart_prompts_owner_insert ON smart_prompts FOR INSERT WITH CHECK (auth.uid()::text = seller_id);
CREATE POLICY smart_prompts_owner_update ON smart_prompts FOR UPDATE USING (auth.uid()::text = seller_id);


