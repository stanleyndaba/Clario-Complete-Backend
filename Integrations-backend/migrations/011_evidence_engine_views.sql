-- Migration: helper views for analytics/verification (optional)

CREATE OR REPLACE VIEW v_evidence_document_items AS
SELECT d.id AS document_id,
       d.seller_id,
       d.supplier_name,
       d.invoice_number,
       d.document_date,
       li.sku,
       li.asin,
       li.quantity,
       li.unit_cost
FROM evidence_documents d
LEFT JOIN evidence_line_items li ON li.document_id = d.id;

-- Simple view to see linked evidence per dispute
CREATE OR REPLACE VIEW v_dispute_evidence AS
SELECT l.dispute_case_id,
       l.evidence_document_id,
       l.relevance_score,
       d.supplier_name,
       d.invoice_number,
       d.document_date
FROM dispute_evidence_links l
JOIN evidence_documents d ON d.id = l.evidence_document_id;







