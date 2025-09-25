-- Security & Compliance Enhancements

-- Per-tenant encryption key versioning
ALTER TABLE IF EXISTS evidence_sources
    ADD COLUMN IF NOT EXISTS encryption_key_version INTEGER NOT NULL DEFAULT 1;

-- Consent/audit logs for evidence connections
CREATE TABLE IF NOT EXISTS evidence_consent_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider evidence_provider NOT NULL,
    scopes JSONB NOT NULL DEFAULT '[]',
    event TEXT NOT NULL CHECK (event IN ('connect','refresh','revoke')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_consent_user ON evidence_consent_log(user_id);
CREATE INDEX IF NOT EXISTS idx_evidence_consent_provider ON evidence_consent_log(provider);

-- Retention/purge support
ALTER TABLE IF EXISTS evidence_documents
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

