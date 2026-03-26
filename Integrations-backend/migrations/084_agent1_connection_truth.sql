-- Migration: 084_agent1_connection_truth
-- Purpose: Enforce truthful Amazon OAuth connection contracts for tokens and evidence sources

-- ---------------------------------------------------------------------------
-- TOKENS: make Amazon connections tenant/store scoped
-- ---------------------------------------------------------------------------

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS store_id TEXT;

ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_user_id_provider_key;
DROP INDEX IF EXISTS idx_tokens_user_provider;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_non_amazon_user_provider_unique
  ON tokens(user_id, provider)
  WHERE provider <> 'amazon';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_amazon_scope_unique
  ON tokens(user_id, provider, tenant_id, store_id)
  WHERE provider = 'amazon';

ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_amazon_scope_check;
ALTER TABLE tokens
  ADD CONSTRAINT tokens_amazon_scope_check
  CHECK (provider <> 'amazon' OR (tenant_id IS NOT NULL AND store_id IS NOT NULL))
  NOT VALID;

-- ---------------------------------------------------------------------------
-- EVIDENCE SOURCES: stabilize Amazon bookkeeping contract
-- ---------------------------------------------------------------------------

ALTER TABLE evidence_sources ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE evidence_sources ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE evidence_sources ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

ALTER TABLE evidence_sources DROP CONSTRAINT IF EXISTS evidence_sources_provider_check;
ALTER TABLE evidence_sources
  ADD CONSTRAINT evidence_sources_provider_check
  CHECK (provider IN (
    'amazon',
    'gmail',
    'outlook',
    'dropbox',
    'gdrive',
    'onedrive',
    's3',
    'other',
    'manual_upload',
    'test_generator',
    'test_e2e',
    'api_upload',
    'webhook',
    'local'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_sources_amazon_scope_unique
  ON evidence_sources(tenant_id, user_id, provider, store_id)
  WHERE provider = 'amazon';

ALTER TABLE evidence_sources DROP CONSTRAINT IF EXISTS evidence_sources_amazon_scope_check;
ALTER TABLE evidence_sources
  ADD CONSTRAINT evidence_sources_amazon_scope_check
  CHECK (provider <> 'amazon' OR (tenant_id IS NOT NULL AND user_id IS NOT NULL AND store_id IS NOT NULL))
  NOT VALID;
