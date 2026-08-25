-- Forward-only reconciliation for an unrecorded/undeployed Transfer Ledger
-- observation rail. It is intentionally independent of the historical
-- 129_transfer_ledger_observation_rail.sql ledger record and must be applied as
-- its own immutable filename. It preserves source facts only and never creates
-- transfer claims, economic values, or inventory_transfers links.
--
-- The canonical runner executes each migration in a transaction. Fail fast if a
-- conflicting lock persists; no partial schema or feature-flag change can commit.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Preserve immutable provider facts on both existing Ledger rails. Existing
-- detector-facing quantity and quantity_direction fields remain unchanged.
ALTER TABLE IF EXISTS inventory_ledger
  ADD COLUMN IF NOT EXISTS provider_row_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS provider_event_type_raw TEXT,
  ADD COLUMN IF NOT EXISTS raw_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS event_datetime TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_store TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS unreconciled_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS marketplace_id VARCHAR(64);

ALTER TABLE IF EXISTS inventory_ledger_events
  ADD COLUMN IF NOT EXISTS provider_row_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS provider_event_type_raw TEXT,
  ADD COLUMN IF NOT EXISTS raw_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS event_datetime TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_store TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS unreconciled_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS marketplace_id VARCHAR(64);

-- Current production has both a legacy inventory_ledger_events unique index and
-- its backing unique constraint. Drop both business-key constraints before
-- introducing fingerprint identities; otherwise materially distinct provider
-- rows can still be suppressed despite the new fingerprint columns.
ALTER TABLE IF EXISTS inventory_ledger
  DROP CONSTRAINT IF EXISTS uq_inventory_ledger_event;

ALTER TABLE IF EXISTS inventory_ledger_events
  DROP CONSTRAINT IF EXISTS uq_ledger_event;

DROP INDEX IF EXISTS inventory_ledger_tenant_event_unique;
DROP INDEX IF EXISTS inventory_ledger_events_tenant_user_event_unique;

-- Retain legacy/manual idempotency only where a provider fingerprint is absent.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_legacy_event_unique
  ON inventory_ledger (tenant_id, seller_id, event_date, fnsku, event_type, reference_id)
  WHERE provider_row_fingerprint IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_events_legacy_event_unique
  ON inventory_ledger_events (tenant_id, user_id, fnsku, event_type, event_date, reference_id)
  WHERE provider_row_fingerprint IS NULL;

-- Provider rows are scoped by immutable provider fingerprint. NULL fingerprints
-- remain distinct, so historical/manual rows are neither migrated nor reinterpreted.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_provider_fingerprint_unique
  ON inventory_ledger (tenant_id, seller_id, provider_row_fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_ledger_events_provider_fingerprint_unique
  ON inventory_ledger_events (tenant_id, user_id, provider_row_fingerprint);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_events_transfer_observation_scope
  ON inventory_ledger_events (tenant_id, user_id, store_id, sync_id, source, provider_event_type_raw);

CREATE TABLE IF NOT EXISTS transfer_ledger_source_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  store_id UUID NOT NULL,
  marketplace_id VARCHAR(64) NOT NULL,
  sync_id TEXT NOT NULL,
  ledger_sync_id TEXT NOT NULL,
  provider_source VARCHAR(100) NOT NULL DEFAULT 'amazon_inventory_ledger',
  observation_version VARCHAR(64) NOT NULL,
  health_status VARCHAR(64) NOT NULL,
  history_coverage_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
  history_coverage_start TIMESTAMPTZ,
  history_coverage_end TIMESTAMPTZ,
  observed_transfer_event_count INTEGER NOT NULL DEFAULT 0,
  ambiguity_count INTEGER NOT NULL DEFAULT 0,
  error_class VARCHAR(100),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfer_ledger_source_runs_health_status_check CHECK (
    health_status IN (
      'AVAILABLE_DATA',
      'AVAILABLE_ZERO_QUALIFYING_DATA',
      'AVAILABLE_PARTIAL_HISTORY',
      'UNSUPPORTED_EVENT_SEMANTICS',
      'AMBIGUOUS_TRANSFER_EVIDENCE',
      'ACCESS_DENIED',
      'PARSER_FAILURE',
      'RATE_LIMITED_OR_TEMPORARY_ERROR'
    )
  ),
  CONSTRAINT transfer_ledger_source_runs_coverage_check CHECK (
    history_coverage_status IN ('FULL', 'PARTIAL', 'UNKNOWN')
  )
);

CREATE INDEX IF NOT EXISTS transfer_ledger_source_runs_scope_sync_idx
  ON transfer_ledger_source_runs (
    tenant_id, user_id, store_id, marketplace_id, sync_id, completed_at DESC
  );

CREATE INDEX IF NOT EXISTS transfer_ledger_source_runs_scope_health_idx
  ON transfer_ledger_source_runs (
    tenant_id, user_id, store_id, marketplace_id, health_status, completed_at DESC
  );

CREATE TABLE IF NOT EXISTS transfer_ledger_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_run_id UUID NOT NULL REFERENCES transfer_ledger_source_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  store_id UUID NOT NULL,
  marketplace_id VARCHAR(64) NOT NULL,
  sync_id TEXT NOT NULL,
  provider_source VARCHAR(100) NOT NULL DEFAULT 'amazon_inventory_ledger',
  provider_event_type_raw VARCHAR(255) NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  event_datetime TIMESTAMPTZ,
  fnsku VARCHAR(255) NOT NULL,
  sku VARCHAR(255),
  asin VARCHAR(32),
  reference_id VARCHAR(512),
  raw_quantity INTEGER NOT NULL,
  fulfillment_center VARCHAR(255),
  country VARCHAR(32),
  disposition VARCHAR(255),
  reason TEXT,
  reconciled_quantity INTEGER,
  unreconciled_quantity INTEGER,
  provider_store TEXT,
  provider_row_fingerprint VARCHAR(128) NOT NULL,
  observation_state VARCHAR(64) NOT NULL DEFAULT 'PENDING_PROVIDER_SEMANTICS',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingestion_version VARCHAR(64) NOT NULL,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfer_ledger_observations_state_check CHECK (
    observation_state IN ('UNPAIRED', 'AMBIGUOUS', 'PENDING_PROVIDER_SEMANTICS')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS transfer_ledger_observations_provider_scope_unique
  ON transfer_ledger_observations (
    tenant_id, user_id, store_id, marketplace_id, provider_source, provider_row_fingerprint
  );

CREATE INDEX IF NOT EXISTS transfer_ledger_observations_detector_scope_idx
  ON transfer_ledger_observations (
    tenant_id, user_id, store_id, marketplace_id, sync_id, event_date DESC
  );

CREATE INDEX IF NOT EXISTS transfer_ledger_observations_source_run_idx
  ON transfer_ledger_observations (source_run_id);

-- The reconciliation does not infer source/destination route, sent/received
-- quantities, lifecycle, arrival, recovery value, or a claim-path linkage.
-- It only creates a durable, isolated observation store.

-- An existing unsafe row is reconciled to the certified default. The flag is
-- always explicitly disabled, OFF, zero-rollout, and claim_capable false.
INSERT INTO feature_flags (
  flag_name,
  description,
  flag_type,
  is_enabled,
  rollout_percentage,
  target_users,
  exclude_users,
  conditions,
  payload,
  metrics,
  auto_expand
)
VALUES (
  'connected_transfer_ledger_observation',
  'SHADOW-only Amazon Ledger WhseTransfers observation rail. Never emits transfer claims or economic value.',
  'feature',
  FALSE,
  0,
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  '{}'::jsonb,
  '{"mode":"OFF","claim_capable":false,"observation_version":"v1"}'::jsonb,
  '{}'::jsonb,
  FALSE
)
ON CONFLICT (flag_name) DO UPDATE
SET
  description = EXCLUDED.description,
  flag_type = EXCLUDED.flag_type,
  is_enabled = FALSE,
  rollout_percentage = 0,
  target_users = ARRAY[]::TEXT[],
  exclude_users = ARRAY[]::TEXT[],
  conditions = '{}'::jsonb,
  payload = '{"mode":"OFF","claim_capable":false,"observation_version":"v1"}'::jsonb,
  metrics = '{}'::jsonb,
  auto_expand = FALSE,
  updated_at = NOW();
