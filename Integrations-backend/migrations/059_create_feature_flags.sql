-- Migration 059: Create Feature Flags System
-- Purpose: Support featureFlagService.ts (Layer 6 canary/rollout system)
-- Also seeds 'agent7_filing_enabled' kill switch required by Agent 7 patches
-- Run this in Supabase SQL Editor

-- ============================================================
-- TABLE: feature_flags
-- Main flag definitions - one row per flag
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  flag_name        TEXT NOT NULL UNIQUE,
  description      TEXT,
  flag_type        TEXT NOT NULL DEFAULT 'feature'
                     CHECK (flag_type IN ('rule_update', 'threshold_change', 'evidence_requirement', 'feature', 'experiment')),
  is_enabled       BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  target_users     TEXT[],          -- NULL = all users
  exclude_users    TEXT[],          -- Users explicitly excluded
  conditions       JSONB NOT NULL DEFAULT '{}',
  payload          JSONB NOT NULL DEFAULT '{}',
  metrics          JSONB NOT NULL DEFAULT '{}',
  success_metric   TEXT,
  success_threshold DECIMAL(10,4),
  auto_expand      BOOLEAN NOT NULL DEFAULT false,
  created_by       TEXT,
  expires_at       TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLE: feature_flag_metrics
-- Stores A/B test metric measurements per flag
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_flag_metrics (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  flag_id          UUID REFERENCES feature_flags(id) ON DELETE CASCADE,
  flag_name        TEXT NOT NULL,
  metric_name      TEXT NOT NULL,
  metric_value     DECIMAL(15,4) NOT NULL,
  is_control_group BOOLEAN NOT NULL DEFAULT false,
  period_start     TIMESTAMP WITH TIME ZONE,
  period_end       TIMESTAMP WITH TIME ZONE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLE: feature_flag_evaluations
-- Audit log of every flag check (user, result, reason)
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  flag_id      UUID REFERENCES feature_flags(id) ON DELETE CASCADE,
  flag_name    TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  evaluated_to BOOLEAN NOT NULL,
  reason       TEXT,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_feature_flags_flag_name   ON feature_flags(flag_name);
CREATE INDEX IF NOT EXISTS idx_feature_flags_is_enabled  ON feature_flags(is_enabled);
CREATE INDEX IF NOT EXISTS idx_feature_flags_flag_type   ON feature_flags(flag_type);

CREATE INDEX IF NOT EXISTS idx_ff_metrics_flag_name      ON feature_flag_metrics(flag_name);
CREATE INDEX IF NOT EXISTS idx_ff_metrics_created_at     ON feature_flag_metrics(created_at);

CREATE INDEX IF NOT EXISTS idx_ff_evals_flag_name        ON feature_flag_evaluations(flag_name);
CREATE INDEX IF NOT EXISTS idx_ff_evals_user_id          ON feature_flag_evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_ff_evals_created_at       ON feature_flag_evaluations(created_at);

-- ============================================================
-- AUTO-UPDATE TRIGGER
-- ============================================================
CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ROW LEVEL SECURITY
-- feature_flags are admin-managed; read-only for authenticated users
-- ============================================================
ALTER TABLE feature_flags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_evaluations ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read flags (service uses supabaseAdmin which bypasses RLS)
CREATE POLICY "Authenticated users can read feature flags"
  ON feature_flags FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only service role can insert/update (via supabaseAdmin)
CREATE POLICY "Service role can manage feature flags"
  ON feature_flags FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage flag metrics"
  ON feature_flag_metrics FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage flag evaluations"
  ON feature_flag_evaluations FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- SEED: Agent 7 Kill Switch (REQUIRED)
-- 
-- is_enabled = true  → filing is ACTIVE (normal operation)
-- is_enabled = false → ALL filing halted immediately (emergency stop)
--
-- To halt all filing: UPDATE feature_flags SET is_enabled = false WHERE flag_name = 'agent7_filing_enabled';
-- To resume filing:   UPDATE feature_flags SET is_enabled = true  WHERE flag_name = 'agent7_filing_enabled';
-- ============================================================
INSERT INTO feature_flags (
  flag_name,
  description,
  flag_type,
  is_enabled,
  rollout_percentage,
  conditions,
  payload,
  metrics,
  auto_expand,
  created_by
)
VALUES (
  'agent7_filing_enabled',
  'Global kill switch for Agent 7 automated SP-API refund filing. Set is_enabled=false to halt ALL filing immediately without a code deploy.',
  'feature',
  true,   -- ACTIVE: Agent 7 is running
  100,    -- 100% rollout (applies to all sellers)
  '{}',
  '{}',
  '{}',
  false,
  'system'
)
ON CONFLICT (flag_name) DO NOTHING;
