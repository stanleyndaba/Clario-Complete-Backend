-- Evidence Records archive lifecycle durability
-- Ensures the tenant-scoped evidence record has a durable JSONB home for
-- non-destructive lifecycle and provenance metadata such as archived_at.

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
