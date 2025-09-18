-- Migration: JSONB GIN index on evidence_documents.extracted for fallback queries

-- Requires pg_trgm or jsonb_path_ops depending on strategy; here we use default GIN jsonb ops
CREATE INDEX IF NOT EXISTS idx_evidence_documents_extracted_gin ON evidence_documents USING GIN (extracted);


