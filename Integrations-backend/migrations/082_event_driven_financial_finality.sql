-- Migration: 082_event_driven_financial_finality
-- Purpose: Durable event-driven work items for recoveries and billing

CREATE TABLE IF NOT EXISTS recovery_work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  tenant_slug TEXT,
  user_id TEXT NOT NULL,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  source_event_type TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'quarantined', 'failed_retry_exhausted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  quarantined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_work_items_idempotency
  ON recovery_work_items(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_recovery_work_items_pending
  ON recovery_work_items(status, next_attempt_at, tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_recovery_work_items_dispute
  ON recovery_work_items(dispute_case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  tenant_slug TEXT,
  user_id TEXT NOT NULL,
  dispute_case_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
  recovery_id UUID REFERENCES recoveries(id) ON DELETE SET NULL,
  source_event_type TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'quarantined', 'failed_retry_exhausted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  quarantined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_work_items_idempotency
  ON billing_work_items(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_billing_work_items_pending
  ON billing_work_items(status, next_attempt_at, tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_billing_work_items_recovery
  ON billing_work_items(recovery_id, dispute_case_id, created_at DESC);

COMMENT ON TABLE recovery_work_items IS 'Durable recovery work created from canonical financial lifecycle events. Cron sweep is backstop only.';
COMMENT ON TABLE billing_work_items IS 'Durable billing work created from reconciled recovery finality events. Cron sweep is backstop only.';
