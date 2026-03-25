-- Migration: 081_capacity_control_plane
-- Purpose: Durable worker continuation checkpoints for backlog draining

CREATE TABLE IF NOT EXISTS worker_continuation_state (
  worker_name TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  cursor_value TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (worker_name, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_continuation_state_updated_at
  ON worker_continuation_state(updated_at DESC);

COMMENT ON TABLE worker_continuation_state IS 'Durable continuation checkpoints used by scan-based workers to resume backlog draining without restarting from the same first page every run.';
COMMENT ON COLUMN worker_continuation_state.cursor_value IS 'Opaque continuation cursor (typically last processed entity id) for a worker+tenant pair.';
