-- Per-tenant KMS key id on evidence_sources

ALTER TABLE IF EXISTS evidence_sources
    ADD COLUMN IF NOT EXISTS kms_key_id TEXT;

