-- P1 Inbound Inspector: canonical Amazon inbound receiving rail.
-- This migration deliberately does not alter or migrate the legacy/customer `shipments` table.

CREATE TABLE IF NOT EXISTS inbound_source_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  store_id UUID,
  sync_id TEXT,
  marketplace_id VARCHAR(64) NOT NULL,
  provider_source VARCHAR(100) NOT NULL,
  provider_contract_version VARCHAR(64) NOT NULL,
  health_status VARCHAR(64) NOT NULL,
  history_coverage_status VARCHAR(64) NOT NULL DEFAULT 'UNKNOWN',
  requested_after TIMESTAMPTZ,
  requested_before TIMESTAMPTZ,
  observed_oldest_updated_at TIMESTAMPTZ,
  observed_newest_updated_at TIMESTAMPTZ,
  provider_request_count INTEGER NOT NULL DEFAULT 0,
  provider_error_code VARCHAR(100),
  provider_error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inbound_source_runs_health_status_check CHECK (
    health_status IN (
      'AVAILABLE_DATA',
      'AVAILABLE_ZERO_QUALIFYING_DATA',
      'AVAILABLE_PARTIAL_HISTORY',
      'ACCESS_DENIED',
      'UNSUPPORTED_ACCOUNT_OR_MARKETPLACE',
      'PARSER_FAILURE',
      'RATE_LIMITED_OR_TEMPORARY_ERROR',
      'API_PENDING',
      'PROVIDER_CANCELLED',
      'PROVIDER_FATAL'
    )
  ),
  CONSTRAINT inbound_source_runs_coverage_check CHECK (
    history_coverage_status IN ('FULL', 'PARTIAL', 'UNKNOWN', 'NOT_APPLICABLE')
  )
);

-- A source run records one provider attempt. Retries for the same Connected Audit
-- sync must remain observable instead of failing on an artificial uniqueness rule.
CREATE INDEX IF NOT EXISTS inbound_source_runs_scope_provider_sync_idx
  ON inbound_source_runs (
    tenant_id,
    user_id,
    marketplace_id,
    provider_source,
    sync_id,
    completed_at DESC
  );

CREATE INDEX IF NOT EXISTS inbound_source_runs_scope_status_idx
  ON inbound_source_runs (tenant_id, user_id, marketplace_id, health_status, completed_at DESC);

CREATE TABLE IF NOT EXISTS inbound_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  store_id UUID,
  sync_id TEXT,
  marketplace_id VARCHAR(64) NOT NULL,
  provider_shipment_id VARCHAR(255) NOT NULL,
  provider_plan_id VARCHAR(255),
  provider_shipment_confirmation_id VARCHAR(255),
  shipment_status_raw VARCHAR(100) NOT NULL,
  shipment_status_canonical VARCHAR(100) NOT NULL,
  status_observed_at TIMESTAMPTZ NOT NULL,
  shipment_created_at TIMESTAMPTZ,
  last_provider_updated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  destination_fulfillment_center_id VARCHAR(255),
  carrier VARCHAR(255),
  tracking_number VARCHAR(255),
  provider_source VARCHAR(100) NOT NULL,
  provider_contract_version VARCHAR(64) NOT NULL,
  source_run_id UUID REFERENCES inbound_source_runs(id) ON DELETE SET NULL,
  source_observed_at TIMESTAMPTZ NOT NULL,
  ingestion_version VARCHAR(64) NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inbound_shipments_status_check CHECK (
    shipment_status_canonical IN (
      'PLANNED',
      'IN_TRANSIT',
      'DELIVERED_OR_CHECKED_IN',
      'RECEIVING',
      'CLOSED',
      'CANCELLED_OR_DELETED',
      'PROVIDER_ERROR_OR_UNKNOWN'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_shipments_provider_scope_unique
  ON inbound_shipments (tenant_id, user_id, marketplace_id, provider_source, provider_shipment_id);

CREATE INDEX IF NOT EXISTS inbound_shipments_detector_scope_idx
  ON inbound_shipments (tenant_id, user_id, sync_id, shipment_status_canonical, status_observed_at DESC);

CREATE INDEX IF NOT EXISTS inbound_shipments_source_run_idx
  ON inbound_shipments (source_run_id);

CREATE TABLE IF NOT EXISTS inbound_shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_shipment_id UUID NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  store_id UUID,
  sync_id TEXT,
  marketplace_id VARCHAR(64) NOT NULL,
  provider_shipment_id VARCHAR(255) NOT NULL,
  provider_item_identity VARCHAR(600) NOT NULL,
  sku VARCHAR(255) NOT NULL,
  fnsku VARCHAR(255),
  asin VARCHAR(32),
  quantity_shipped INTEGER NOT NULL,
  quantity_received INTEGER,
  quantity_in_case INTEGER,
  release_date DATE,
  label_owner VARCHAR(64),
  prep_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_source VARCHAR(100) NOT NULL,
  provider_contract_version VARCHAR(64) NOT NULL,
  source_run_id UUID REFERENCES inbound_source_runs(id) ON DELETE SET NULL,
  source_observed_at TIMESTAMPTZ NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inbound_shipment_items_nonnegative_quantities CHECK (
    quantity_shipped >= 0
    AND (quantity_received IS NULL OR quantity_received >= 0)
    AND (quantity_in_case IS NULL OR quantity_in_case > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inbound_shipment_items_provider_scope_unique
  ON inbound_shipment_items (
    tenant_id,
    user_id,
    marketplace_id,
    provider_source,
    provider_shipment_id,
    provider_item_identity
  );

CREATE INDEX IF NOT EXISTS inbound_shipment_items_detector_scope_idx
  ON inbound_shipment_items (tenant_id, user_id, sync_id, provider_shipment_id, sku);

CREATE INDEX IF NOT EXISTS inbound_shipment_items_parent_idx
  ON inbound_shipment_items (inbound_shipment_id);

-- Existing customer-fulfilled `shipments` rows intentionally remain untouched.
