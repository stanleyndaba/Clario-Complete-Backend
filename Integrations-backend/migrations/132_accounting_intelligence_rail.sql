-- ============================================================================
-- 132_accounting_intelligence_rail.sql
-- Margin Accounting Intelligence Rail
--
-- This migration is additive. It preserves Phase-0 provider records and extends
-- them through explicit sync, evidence, mapping, cost, and reconciliation truth.
-- Raw provider payloads remain in accounting_records and are intentionally absent
-- from the browser-safe projection below.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Durable sync audit trail and checkpoint ownership.
-- A provider checkpoint advances only when the run is completed by server code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  source_id UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  trigger TEXT NOT NULL CHECK (trigger IN ('oauth_initial', 'manual', 'scheduled', 'reconnect', 'retry')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_no_data', 'failed', 'reconnect_required', 'cancelled')),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  queue_job_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  records_discovered INTEGER NOT NULL DEFAULT 0 CHECK (records_discovered >= 0),
  records_inserted INTEGER NOT NULL DEFAULT 0 CHECK (records_inserted >= 0),
  records_updated INTEGER NOT NULL DEFAULT 0 CHECK (records_updated >= 0),
  records_skipped INTEGER NOT NULL DEFAULT 0 CHECK (records_skipped >= 0),
  sync_window_start TIMESTAMPTZ,
  sync_window_end TIMESTAMPTZ,
  provider_checkpoint_before TIMESTAMPTZ,
  provider_checkpoint_after TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_sync_runs_tenant_provider_created
  ON accounting_sync_runs (tenant_id, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_sync_runs_source_created
  ON accounting_sync_runs (source_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_sync_runs_active_tenant_provider
  ON accounting_sync_runs (tenant_id, provider)
  WHERE status IN ('queued', 'running');

-- Store the last *successfully persisted* checkpoint on the existing source.
ALTER TABLE evidence_sources
  ADD COLUMN IF NOT EXISTS accounting_sync_checkpoint TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounting_organisation_id TEXT,
  ADD COLUMN IF NOT EXISTS accounting_organisation_name TEXT,
  ADD COLUMN IF NOT EXISTS accounting_organisation_selected_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Provider truth must be interpreted before it becomes product cost truth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  accounting_record_id UUID NOT NULL REFERENCES accounting_records(id) ON DELETE CASCADE,
  source_id UUID REFERENCES evidence_sources(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  provider_record_id TEXT NOT NULL,
  provider_record_type TEXT NOT NULL,
  supplier_name TEXT,
  reference_number TEXT,
  transaction_date DATE,
  currency TEXT,
  total_amount NUMERIC(18, 2),
  line_item_index INTEGER,
  line_item_reference TEXT,
  line_item JSONB,
  document_available BOOLEAN NOT NULL DEFAULT FALSE,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'superseded', 'voided', 'unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT accounting_evidence_record_line_unique UNIQUE (accounting_record_id, line_item_index)
);

CREATE INDEX IF NOT EXISTS idx_accounting_evidence_tenant_provider
  ON accounting_evidence (tenant_id, provider, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_evidence_record
  ON accounting_evidence (accounting_record_id);
CREATE INDEX IF NOT EXISTS idx_accounting_evidence_supplier
  ON accounting_evidence (tenant_id, supplier_name);

-- ---------------------------------------------------------------------------
-- Mapping is explicit, versioned, and reviewable. It never changes raw evidence.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounting_sku_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('quickbooks', 'xero')),
  provider_item_id TEXT,
  provider_item_code TEXT,
  provider_item_name TEXT,
  sku TEXT NOT NULL,
  asin TEXT,
  fnsku TEXT,
  mapping_method TEXT NOT NULL CHECK (mapping_method IN ('exact_item_code', 'exact_asin', 'deterministic_identifier', 'fuzzy_suggestion', 'seller_manual')),
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('authoritative', 'high', 'medium', 'low', 'unresolved')),
  confidence_score NUMERIC(4, 3) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  status TEXT NOT NULL CHECK (status IN ('suggested', 'confirmed', 'rejected', 'superseded', 'unresolved')),
  effective_from DATE,
  effective_to DATE,
  seller_override BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  evidence_id UUID REFERENCES accounting_evidence(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_mapping_id UUID REFERENCES accounting_sku_mappings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_sku_mappings_tenant_sku
  ON accounting_sku_mappings (tenant_id, sku, status, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_sku_mappings_provider_item
  ON accounting_sku_mappings (tenant_id, provider, provider_item_code, status);

-- ---------------------------------------------------------------------------
-- Reuse product_costs; add authoritative accounting provenance and cost semantics.
-- ---------------------------------------------------------------------------
ALTER TABLE product_costs
  ADD COLUMN IF NOT EXISTS accounting_evidence_id UUID REFERENCES accounting_evidence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_mapping_id UUID REFERENCES accounting_sku_mappings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_classification TEXT,
  ADD COLUMN IF NOT EXISTS confidence_level TEXT,
  ADD COLUMN IF NOT EXISTS source_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_quantity NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS pack_size NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS freight_amount NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS is_authoritative BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE product_costs
  DROP CONSTRAINT IF EXISTS product_costs_confidence_level_check;
ALTER TABLE product_costs
  ADD CONSTRAINT product_costs_confidence_level_check
  CHECK (confidence_level IS NULL OR confidence_level IN ('authoritative', 'high', 'medium', 'low', 'unresolved'));
ALTER TABLE product_costs
  DROP CONSTRAINT IF EXISTS product_costs_cost_classification_check;
ALTER TABLE product_costs
  ADD CONSTRAINT product_costs_cost_classification_check
  CHECK (cost_classification IS NULL OR cost_classification IN ('inventory', 'freight', 'tax', 'service', 'overhead', 'unrelated', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_product_costs_accounting_evidence
  ON product_costs (accounting_evidence_id) WHERE accounting_evidence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_costs_tenant_sku_effective
  ON product_costs (tenant_id, sku, effective_date_start DESC, effective_date_end);

-- ---------------------------------------------------------------------------
-- A reconciliation result records whether provider evidence was unavailable.
-- That state is not an unmatched business outcome.
-- ---------------------------------------------------------------------------
ALTER TABLE recovery_reconciliations
  ADD COLUMN IF NOT EXISTS accounting_record_id UUID REFERENCES accounting_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_evidence_id UUID REFERENCES accounting_evidence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_state TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

ALTER TABLE recovery_reconciliations
  DROP CONSTRAINT IF EXISTS recovery_reconciliations_evidence_state_check;
ALTER TABLE recovery_reconciliations
  ADD CONSTRAINT recovery_reconciliations_evidence_state_check
  CHECK (evidence_state IN ('available', 'unavailable', 'no_data', 'needs_review'));

-- Browser-safe projection: no raw provider payload is selected by this view.
CREATE OR REPLACE VIEW accounting_records_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  tenant_id,
  user_id,
  provider,
  provider_record_id,
  record_type,
  supplier_name,
  transaction_date,
  due_date,
  currency,
  total_amount,
  line_items,
  reference_number,
  memo,
  status,
  provider_updated_at,
  synced_at,
  source_id,
  created_at,
  updated_at
FROM accounting_records;

ALTER TABLE accounting_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_sku_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_sync_runs_tenant_member_select ON accounting_sync_runs;
CREATE POLICY accounting_sync_runs_tenant_member_select
  ON accounting_sync_runs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_memberships tm
    WHERE tm.tenant_id = accounting_sync_runs.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.is_active = TRUE
      AND tm.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS accounting_evidence_tenant_member_select ON accounting_evidence;
CREATE POLICY accounting_evidence_tenant_member_select
  ON accounting_evidence FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_memberships tm
    WHERE tm.tenant_id = accounting_evidence.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.is_active = TRUE
      AND tm.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS accounting_sku_mappings_tenant_member_select ON accounting_sku_mappings;
CREATE POLICY accounting_sku_mappings_tenant_member_select
  ON accounting_sku_mappings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tenant_memberships tm
    WHERE tm.tenant_id = accounting_sku_mappings.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.is_active = TRUE
      AND tm.deleted_at IS NULL
  ));

COMMIT;
