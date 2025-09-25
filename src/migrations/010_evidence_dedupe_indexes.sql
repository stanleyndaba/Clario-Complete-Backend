-- Evidence deduplication and composite indexes

-- Add evidence_hash for cross-source dedupe per user
ALTER TABLE IF EXISTS evidence_documents
    ADD COLUMN IF NOT EXISTS evidence_hash TEXT;

-- Unique dedupe index per user on evidence_hash (only when present)
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_documents_user_hash
ON evidence_documents(user_id, evidence_hash)
WHERE evidence_hash IS NOT NULL;

-- Composite indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_evidence_documents_user_order
ON evidence_documents(user_id, order_id)
WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_documents_user_date
ON evidence_documents(user_id, evidence_date)
WHERE evidence_date IS NOT NULL;

