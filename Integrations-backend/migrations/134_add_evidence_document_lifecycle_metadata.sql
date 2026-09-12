-- Evidence Records archive lifecycle durability
-- Ensures the tenant-scoped evidence record has a durable JSONB home for
-- non-destructive lifecycle and provenance metadata such as archived_at.

-- This migration backfills metadata on existing evidence rows. The backfill is
-- schema maintenance, so temporarily suspend only the evidence write trigger
-- within this transaction; normal application writes remain protected.
ALTER TABLE evidence_documents DISABLE TRIGGER enforce_tenant_active_evidence_documents;

ALTER TABLE evidence_documents
  ADD COLUMN IF NOT EXISTS metadata JSONB;

UPDATE evidence_documents
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

ALTER TABLE evidence_documents
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

ALTER TABLE evidence_documents
  ALTER COLUMN metadata SET NOT NULL;

COMMENT ON COLUMN evidence_documents.metadata IS
  'Non-destructive evidence provenance, ingestion, and lifecycle metadata. Archive and supersession retain history here.';

ALTER TABLE evidence_documents ENABLE TRIGGER enforce_tenant_active_evidence_documents;
