-- Migration: 040_mcde_integration.sql
-- MCDE (Manufacturing Cost Document Engine) Integration
-- Adds columns for OCR extraction and cost component storage

-- Add MCDE columns to evidence_documents
ALTER TABLE evidence_documents 
  ADD COLUMN IF NOT EXISTS mcde_extraction JSONB,
  ADD COLUMN IF NOT EXISTS mcde_cost_components JSONB,
  ADD COLUMN IF NOT EXISTS mcde_confidence DECIMAL(4,3),
  ADD COLUMN IF NOT EXISTS ocr_language TEXT DEFAULT 'eng',
  ADD COLUMN IF NOT EXISTS unit_manufacturing_cost DECIMAL(12,4);

-- Add index for MCDE extraction queries
CREATE INDEX IF NOT EXISTS idx_evidence_documents_mcde_extraction 
  ON evidence_documents USING GIN (mcde_extraction);

-- Add index for cost components queries
CREATE INDEX IF NOT EXISTS idx_evidence_documents_mcde_cost_components 
  ON evidence_documents USING GIN (mcde_cost_components);

-- Add comment for documentation
COMMENT ON COLUMN evidence_documents.mcde_extraction IS 'Full OCR extraction result from MCDE including text and metadata';
COMMENT ON COLUMN evidence_documents.mcde_cost_components IS 'Extracted cost components: material, labor, overhead, shipping, tax';
COMMENT ON COLUMN evidence_documents.mcde_confidence IS 'OCR extraction confidence score (0.0-1.0)';
COMMENT ON COLUMN evidence_documents.ocr_language IS 'OCR language used (e.g., eng, chi_sim, eng+chi_sim)';
COMMENT ON COLUMN evidence_documents.unit_manufacturing_cost IS 'Extracted unit manufacturing cost from invoice';

-- Grant permissions
GRANT SELECT, UPDATE ON evidence_documents TO authenticated;
GRANT SELECT, UPDATE ON evidence_documents TO service_role;
