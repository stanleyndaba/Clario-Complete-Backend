-- Evidence Identifiers & Doc Kind Extension
-- Adds doc_kind and common identifier fields for fast matching and indexing

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'evidence_document_kind'
    ) THEN
        CREATE TYPE evidence_document_kind AS ENUM (
            'email',
            'invoice',
            'receipt',
            'shipping',
            'po',
            'other'
        );
    END IF;
END$$;

-- Add columns if they do not exist
ALTER TABLE IF EXISTS evidence_documents
    ADD COLUMN IF NOT EXISTS doc_kind evidence_document_kind,
    ADD COLUMN IF NOT EXISTS order_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS shipment_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS currency VARCHAR(10),
    ADD COLUMN IF NOT EXISTS sku VARCHAR(64),
    ADD COLUMN IF NOT EXISTS asin VARCHAR(20),
    ADD COLUMN IF NOT EXISTS evidence_date DATE;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_evidence_documents_doc_kind ON evidence_documents(doc_kind);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_order_id ON evidence_documents(order_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_shipment_id ON evidence_documents(shipment_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_evidence_date ON evidence_documents(evidence_date);

COMMENT ON COLUMN evidence_documents.doc_kind IS 'High-level document kind (email, invoice, receipt, shipping, po, other)';
COMMENT ON COLUMN evidence_documents.order_id IS 'Primary order identifier (e.g., Amazon order number)';
COMMENT ON COLUMN evidence_documents.shipment_id IS 'Primary shipment/tracking id if available';
COMMENT ON COLUMN evidence_documents.amount IS 'Primary amount parsed or inferred from metadata';
COMMENT ON COLUMN evidence_documents.currency IS 'Currency code for amount';
COMMENT ON COLUMN evidence_documents.evidence_date IS 'Primary date associated with evidence';

