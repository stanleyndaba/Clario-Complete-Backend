-- ============================================================================
-- 131_create_accounting_records.sql
-- Margin Phase-0 Financial Evidence Connection
--
-- Purpose:
--   1. Remove legacy plaintext OAuth credentials from evidence-source metadata.
--   2. Persist QuickBooks Bill/Purchase and Xero ACCPAY evidence as canonical,
--      tenant-isolated, read-only accounting records.
--   3. Store server-owned accounting read health separately from generic document
--      ingestion so OAuth completion cannot be presented as provider-read proof.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Credential safety: token material belongs only in encrypted token storage.
-- ---------------------------------------------------------------------------
UPDATE evidence_sources
SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'access_token' - 'refresh_token')
WHERE metadata ? 'access_token' OR metadata ? 'refresh_token';

-- ---------------------------------------------------------------------------
-- Accounting source health belongs on the source row, but is not generic
-- document ingestion truth. `pending` means OAuth completed but no successful
-- accounting provider read exists yet. `no_data` is a successful zero-record
-- provider read, not a failure.
-- ---------------------------------------------------------------------------
ALTER TABLE evidence_sources
  ADD COLUMN IF NOT EXISTS accounting_read_status TEXT,
  ADD COLUMN IF NOT EXISTS accounting_last_read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounting_last_error TEXT,
  ADD COLUMN IF NOT EXISTS accounting_record_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE evidence_sources
  DROP CONSTRAINT IF EXISTS evidence_sources_accounting_read_status_check;

ALTER TABLE evidence_sources
  ADD CONSTRAINT evidence_sources_accounting_read_status_check
  CHECK (
    accounting_read_status IS NULL
    OR accounting_read_status IN ('pending', 'verified', 'no_data', 'failed', 'reconnect_required')
  );

CREATE INDEX IF NOT EXISTS idx_evidence_sources_accounting_health
  ON evidence_sources (tenant_id, provider, accounting_read_status)
  WHERE provider IN ('quickbooks', 'xero');

-- Migration 084 tightened this legacy provider list before QuickBooks and Xero
-- were actually read. Extend it without excluding the document providers already
-- supported by Margin.
ALTER TABLE evidence_sources DROP CONSTRAINT IF EXISTS evidence_sources_provider_check;
ALTER TABLE evidence_sources
  ADD CONSTRAINT evidence_sources_provider_check
  CHECK (provider IN (
    'amazon',
    'gmail', 'outlook', 'dropbox', 'gdrive', 'onedrive',
    'slack', 'adobe_sign',
    'quickbooks', 'xero',
    's3', 'other', 'manual_upload', 'test_generator', 'test_e2e',
    'api_upload', 'webhook', 'local'
  )) NOT VALID;

-- ---------------------------------------------------------------------------
-- Migration 084 created a partial UNIQUE(user_id, provider) index for every
-- non-Amazon credential. That pre-existing index must be replaced before an
-- accounting provider can be connected to two authorised Margin workspaces.
-- ---------------------------------------------------------------------------
ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_user_id_provider_key;
DROP INDEX IF EXISTS idx_tokens_non_amazon_user_provider_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_non_accounting_non_amazon_user_provider_unique
  ON tokens (user_id, provider)
  WHERE provider NOT IN ('amazon', 'quickbooks', 'xero');

CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_accounting_user_provider_tenant_unique
  ON tokens (user_id, provider, tenant_id)
  WHERE provider IN ('quickbooks', 'xero') AND tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Canonical, provider-neutral Financial Evidence Connection records.
-- `raw_data` is retained for controlled evidence traceability; it must never be
-- delivered to the browser through a generic integration-status response.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  provider_record_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('bill', 'purchase', 'accpay')),
  supplier_name TEXT,
  transaction_date DATE,
  due_date DATE,
  currency TEXT,
  total_amount NUMERIC(18, 2),
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference_number TEXT,
  memo TEXT,
  status TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_id UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounting_records_tenant_provider_record_unique
    UNIQUE (tenant_id, provider, provider_record_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_records_tenant_provider_synced
  ON accounting_records (tenant_id, provider, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_records_tenant_supplier
  ON accounting_records (tenant_id, supplier_name);
CREATE INDEX IF NOT EXISTS idx_accounting_records_tenant_transaction_date
  ON accounting_records (tenant_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_records_source
  ON accounting_records (source_id);

ALTER TABLE accounting_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_records_tenant_member_select ON accounting_records;
CREATE POLICY accounting_records_tenant_member_select
  ON accounting_records
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM tenant_memberships tm
      WHERE tm.tenant_id = accounting_records.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.is_active = TRUE
        AND tm.deleted_at IS NULL
    )
  );

-- Provider reads, upserts, health transitions, and source linkage are backend
-- owned. No browser policy grants INSERT, UPDATE, or DELETE on this evidence.

COMMIT;
