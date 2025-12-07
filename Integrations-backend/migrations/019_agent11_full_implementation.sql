-- Migration: Agent 11 Full Implementation - 7-Layer Adaptive Learning System
-- Creates tables for rules engine, feature flags, schema monitoring, rejection patterns, and manual review

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- LAYER 1: SP-API Schema Monitoring
-- ============================================

-- Table to track SP-API schema changes
CREATE TABLE IF NOT EXISTS schema_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_name TEXT NOT NULL,                    -- e.g., 'sellers', 'orders', 'fba-inventory'
    endpoint TEXT NOT NULL,                    -- e.g., '/fba/inbound/v0/shipments'
    change_type TEXT NOT NULL CHECK (change_type IN (
        'new_field',
        'deprecated_field',
        'new_endpoint',
        'deprecated_endpoint',
        'new_claim_type',
        'schema_change'
    )),
    field_name TEXT,                           -- Affected field name
    old_schema JSONB,                          -- Previous schema snapshot
    new_schema JSONB,                          -- New schema snapshot
    description TEXT,                          -- Human-readable description
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table to store SP-API schema snapshots
CREATE TABLE IF NOT EXISTS schema_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_name TEXT NOT NULL,
    version TEXT,
    schema_hash TEXT NOT NULL,                 -- Hash for quick comparison
    full_schema JSONB NOT NULL,                -- Complete schema
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(api_name, schema_hash)
);

-- ============================================
-- LAYER 2: Rules Engine as Config
-- ============================================

-- Table for claim rules (hot-updatable without code changes)
CREATE TABLE IF NOT EXISTS claim_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_name TEXT NOT NULL UNIQUE,
    claim_type TEXT NOT NULL,                  -- e.g., 'lost_inventory', 'damaged_item', 'overcharge'
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'detection',                           -- For claim detection
        'validation',                          -- For claim validation
        'evidence_requirement',                -- For evidence requirements
        'threshold',                           -- For confidence thresholds
        'filing',                              -- For filing requirements
        'deadline'                             -- For deadline calculations
    )),
    conditions JSONB NOT NULL DEFAULT '{}',    -- Rule conditions (e.g., {"amount_min": 10, "days_since_shipment": 30})
    actions JSONB NOT NULL DEFAULT '{}',       -- Actions to take when rule matches
    priority INTEGER DEFAULT 0,                -- Higher = checked first
    is_active BOOLEAN DEFAULT TRUE,
    version INTEGER DEFAULT 1,
    created_by TEXT,
    updated_by TEXT,
    effective_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    effective_until TIMESTAMP WITH TIME ZONE,  -- NULL = no expiry
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for evidence mappings (what evidence is needed per claim type)
CREATE TABLE IF NOT EXISTS evidence_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_type TEXT NOT NULL,
    evidence_type TEXT NOT NULL,               -- e.g., 'invoice', 'pod', 'tracking', 'photo'
    requirement_level TEXT NOT NULL CHECK (requirement_level IN (
        'mandatory',                           -- Must have
        'recommended',                         -- Should have
        'optional',                            -- Nice to have
        'conditional'                          -- Depends on other factors
    )),
    conditions JSONB DEFAULT '{}',             -- Conditions for when this evidence is needed
    weight DECIMAL(3,2) DEFAULT 1.00,          -- Weight for matching score (0.00-1.00)
    description TEXT,
    amazon_field_name TEXT,                    -- Amazon's field name for this evidence
    is_active BOOLEAN DEFAULT TRUE,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(claim_type, evidence_type)
);

-- ============================================
-- LAYER 5: Auto-Audit & Error Classification
-- ============================================

-- Table for categorized rejection patterns
CREATE TABLE IF NOT EXISTS rejection_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_name TEXT NOT NULL UNIQUE,
    amazon_reason_text TEXT,                   -- Exact text from Amazon
    amazon_reason_code TEXT,                   -- Amazon's reason code if any
    category TEXT NOT NULL CHECK (category IN (
        'missing_evidence',
        'wrong_amount',
        'expired_claim',
        'duplicate_claim',
        'ineligible_item',
        'insufficient_proof',
        'wrong_format',
        'policy_violation',
        'other'
    )),
    subcategory TEXT,                          -- More specific categorization
    is_fixable BOOLEAN DEFAULT TRUE,           -- Can this rejection be fixed?
    fix_action TEXT,                           -- What to do to fix it
    required_evidence TEXT[],                  -- Evidence types needed to fix
    occurrence_count INTEGER DEFAULT 0,        -- How often this pattern occurs
    success_after_fix_rate DECIMAL(5,4),       -- Success rate after applying fix
    auto_update_rule BOOLEAN DEFAULT FALSE,    -- Should this auto-update rules?
    rule_update_applied BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for individual rejections (for learning)
CREATE TABLE IF NOT EXISTS claim_rejections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    dispute_id UUID,                           -- Reference to disputes table
    amazon_case_id TEXT,
    claim_type TEXT,
    rejection_reason TEXT NOT NULL,
    rejection_pattern_id UUID REFERENCES rejection_patterns(id),
    claim_amount DECIMAL(12,2),
    currency TEXT DEFAULT 'USD',
    evidence_provided TEXT[],                  -- What evidence was provided
    evidence_missing TEXT[],                   -- What evidence was missing (if detected)
    fix_attempted BOOLEAN DEFAULT FALSE,
    fix_successful BOOLEAN,
    resubmission_count INTEGER DEFAULT 0,
    final_outcome TEXT CHECK (final_outcome IN ('fixed', 'abandoned', 'escalated', 'pending')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- LAYER 6: Canary + Feature Flags
-- ============================================

-- Table for feature flags with gradual rollout
CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_name TEXT NOT NULL UNIQUE,
    description TEXT,
    flag_type TEXT NOT NULL CHECK (flag_type IN (
        'rule_update',                         -- New claim rule
        'threshold_change',                    -- Threshold adjustment
        'evidence_requirement',                -- New evidence requirement
        'feature',                             -- General feature flag
        'experiment'                           -- A/B test
    )),
    is_enabled BOOLEAN DEFAULT FALSE,
    rollout_percentage INTEGER DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    target_users TEXT[],                       -- Specific users to include
    exclude_users TEXT[],                      -- Specific users to exclude
    conditions JSONB DEFAULT '{}',             -- Additional conditions for activation
    payload JSONB DEFAULT '{}',                -- Flag payload/configuration
    metrics JSONB DEFAULT '{}',                -- Tracked metrics for this flag
    success_metric TEXT,                       -- Primary success metric to track
    success_threshold DECIMAL(5,4),            -- Threshold for auto-expansion
    auto_expand BOOLEAN DEFAULT FALSE,         -- Auto-expand on success?
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE        -- Optional expiry
);

-- Table for feature flag evaluation history
CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id UUID REFERENCES feature_flags(id),
    flag_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    evaluated_to BOOLEAN NOT NULL,             -- TRUE = enabled, FALSE = disabled
    reason TEXT,                               -- Why it evaluated this way
    context JSONB DEFAULT '{}',                -- Context at evaluation time
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for feature flag metrics
CREATE TABLE IF NOT EXISTS feature_flag_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id UUID REFERENCES feature_flags(id),
    flag_name TEXT NOT NULL,
    metric_name TEXT NOT NULL,                 -- e.g., 'approval_rate', 'rejection_rate'
    metric_value DECIMAL(10,4) NOT NULL,
    sample_size INTEGER,
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    is_control_group BOOLEAN DEFAULT FALSE,   -- Control vs treatment
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- LAYER 7: Human-in-the-Loop Backstop
-- ============================================

-- Table for manual review queue
CREATE TABLE IF NOT EXISTS manual_review_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    dispute_id UUID,
    amazon_case_id TEXT,
    review_type TEXT NOT NULL CHECK (review_type IN (
        'repeated_rejection',                  -- Multiple rejections on same claim
        'low_confidence',                      -- Low confidence match
        'new_pattern',                         -- Unknown rejection pattern
        'edge_case',                           -- Unusual case
        'escalation',                          -- User escalated
        'quality_check'                        -- Random quality check
    )),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',
        'assigned',
        'in_review',
        'completed',
        'archived'
    )),
    assigned_to TEXT,                          -- Analyst handling this
    context JSONB DEFAULT '{}',                -- All relevant context
    rejection_history JSONB DEFAULT '[]',      -- History of rejections
    analyst_notes TEXT,
    analyst_correction JSONB,                  -- What the analyst corrected
    correction_type TEXT CHECK (correction_type IN (
        'rule_update',                         -- Update a rule
        'evidence_mapping',                    -- Update evidence mapping
        'threshold_adjustment',                -- Adjust threshold
        'new_pattern',                         -- Register new pattern
        'no_action',                           -- No correction needed
        'escalate'                             -- Needs further escalation
    )),
    fed_back_to_learning BOOLEAN DEFAULT FALSE,
    learning_event_id UUID,                    -- Reference to agent_events if fed back
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Table for analyst corrections history
CREATE TABLE IF NOT EXISTS analyst_corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID REFERENCES manual_review_queue(id),
    analyst_id TEXT NOT NULL,
    correction_type TEXT NOT NULL,
    before_state JSONB,                        -- State before correction
    after_state JSONB,                         -- State after correction
    reasoning TEXT,                            -- Why this correction was made
    impact_assessment TEXT,                    -- Expected impact
    was_applied BOOLEAN DEFAULT FALSE,
    applied_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Schema changes indexes
CREATE INDEX IF NOT EXISTS idx_schema_changes_api_name ON schema_changes(api_name);
CREATE INDEX IF NOT EXISTS idx_schema_changes_change_type ON schema_changes(change_type);
CREATE INDEX IF NOT EXISTS idx_schema_changes_detected_at ON schema_changes(detected_at);
CREATE INDEX IF NOT EXISTS idx_schema_changes_acknowledged ON schema_changes(acknowledged);

-- Claim rules indexes
CREATE INDEX IF NOT EXISTS idx_claim_rules_claim_type ON claim_rules(claim_type);
CREATE INDEX IF NOT EXISTS idx_claim_rules_rule_type ON claim_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_claim_rules_is_active ON claim_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_claim_rules_priority ON claim_rules(priority DESC);

-- Evidence mappings indexes
CREATE INDEX IF NOT EXISTS idx_evidence_mappings_claim_type ON evidence_mappings(claim_type);
CREATE INDEX IF NOT EXISTS idx_evidence_mappings_evidence_type ON evidence_mappings(evidence_type);
CREATE INDEX IF NOT EXISTS idx_evidence_mappings_is_active ON evidence_mappings(is_active);

-- Rejection patterns indexes
CREATE INDEX IF NOT EXISTS idx_rejection_patterns_category ON rejection_patterns(category);
CREATE INDEX IF NOT EXISTS idx_rejection_patterns_is_fixable ON rejection_patterns(is_fixable);

-- Claim rejections indexes
CREATE INDEX IF NOT EXISTS idx_claim_rejections_user_id ON claim_rejections(user_id);
CREATE INDEX IF NOT EXISTS idx_claim_rejections_dispute_id ON claim_rejections(dispute_id);
CREATE INDEX IF NOT EXISTS idx_claim_rejections_pattern_id ON claim_rejections(rejection_pattern_id);
CREATE INDEX IF NOT EXISTS idx_claim_rejections_created_at ON claim_rejections(created_at);

-- Feature flags indexes
CREATE INDEX IF NOT EXISTS idx_feature_flags_flag_name ON feature_flags(flag_name);
CREATE INDEX IF NOT EXISTS idx_feature_flags_flag_type ON feature_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_feature_flags_is_enabled ON feature_flags(is_enabled);

-- Feature flag evaluations indexes
CREATE INDEX IF NOT EXISTS idx_ff_evaluations_flag_id ON feature_flag_evaluations(flag_id);
CREATE INDEX IF NOT EXISTS idx_ff_evaluations_user_id ON feature_flag_evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_ff_evaluations_created_at ON feature_flag_evaluations(created_at);

-- Feature flag metrics indexes
CREATE INDEX IF NOT EXISTS idx_ff_metrics_flag_id ON feature_flag_metrics(flag_id);
CREATE INDEX IF NOT EXISTS idx_ff_metrics_metric_name ON feature_flag_metrics(metric_name);

-- Manual review queue indexes
CREATE INDEX IF NOT EXISTS idx_manual_review_user_id ON manual_review_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_review_status ON manual_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_manual_review_priority ON manual_review_queue(priority);
CREATE INDEX IF NOT EXISTS idx_manual_review_review_type ON manual_review_queue(review_type);
CREATE INDEX IF NOT EXISTS idx_manual_review_created_at ON manual_review_queue(created_at);

-- Analyst corrections indexes
CREATE INDEX IF NOT EXISTS idx_analyst_corrections_review_id ON analyst_corrections(review_id);
CREATE INDEX IF NOT EXISTS idx_analyst_corrections_analyst_id ON analyst_corrections(analyst_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE schema_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejection_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flag_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_corrections ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Service can read schema changes" ON schema_changes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can read schema snapshots" ON schema_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can read claim rules" ON claim_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can read evidence mappings" ON evidence_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service can read rejection patterns" ON rejection_patterns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view their own rejections" ON claim_rejections FOR SELECT TO authenticated 
    USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
CREATE POLICY "Service can read feature flags" ON feature_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view their own flag evaluations" ON feature_flag_evaluations FOR SELECT TO authenticated 
    USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
CREATE POLICY "Service can read flag metrics" ON feature_flag_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can view their own review queue items" ON manual_review_queue FOR SELECT TO authenticated 
    USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));
CREATE POLICY "Analysts can view corrections" ON analyst_corrections FOR SELECT TO authenticated USING (true);

-- ============================================
-- SEED INITIAL DATA
-- ============================================

-- Seed common rejection patterns
INSERT INTO rejection_patterns (pattern_name, amazon_reason_text, category, subcategory, is_fixable, fix_action, required_evidence) VALUES
('missing_pod', 'Proof of delivery required', 'missing_evidence', 'pod', true, 'Upload proof of delivery document', ARRAY['pod', 'tracking']),
('missing_invoice', 'Invoice not provided', 'missing_evidence', 'invoice', true, 'Upload invoice document', ARRAY['invoice']),
('wrong_amount', 'Claimed amount does not match records', 'wrong_amount', 'mismatch', true, 'Verify and correct claim amount', ARRAY['invoice']),
('expired_claim', 'Claim submitted after deadline', 'expired_claim', 'time_limit', false, 'Cannot be fixed - claim expired', NULL),
('duplicate_claim', 'This item has already been claimed', 'duplicate_claim', 'already_filed', false, 'Check existing claims', NULL),
('ineligible_fba', 'Item not eligible for FBA reimbursement', 'ineligible_item', 'fba_policy', false, 'Review FBA eligibility requirements', NULL),
('insufficient_proof', 'Additional documentation required', 'insufficient_proof', 'general', true, 'Provide additional supporting documents', ARRAY['invoice', 'pod', 'photo']),
('wrong_fnsku', 'FNSKU does not match', 'wrong_format', 'identifier', true, 'Verify FNSKU on documents', ARRAY['invoice']),
('vat_required', 'VAT ID required for EU claims', 'missing_evidence', 'vat', true, 'Add VAT ID to proof packet', ARRAY['vat_document'])
ON CONFLICT (pattern_name) DO NOTHING;

-- Seed initial evidence mappings
INSERT INTO evidence_mappings (claim_type, evidence_type, requirement_level, weight, description) VALUES
('lost_inventory', 'invoice', 'mandatory', 1.00, 'Invoice showing purchase of lost items'),
('lost_inventory', 'pod', 'recommended', 0.80, 'Proof of delivery to Amazon'),
('lost_inventory', 'tracking', 'recommended', 0.70, 'Shipment tracking information'),
('damaged_inventory', 'invoice', 'mandatory', 1.00, 'Invoice for damaged items'),
('damaged_inventory', 'photo', 'optional', 0.50, 'Photo of damage if available'),
('overcharge', 'invoice', 'mandatory', 1.00, 'Invoice showing correct amounts'),
('customer_return', 'tracking', 'mandatory', 1.00, 'Return shipment tracking'),
('customer_return', 'invoice', 'recommended', 0.70, 'Original sale invoice')
ON CONFLICT (claim_type, evidence_type) DO NOTHING;

-- Seed initial claim rules
INSERT INTO claim_rules (rule_name, claim_type, rule_type, conditions, actions, priority) VALUES
('lost_inventory_detection', 'lost_inventory', 'detection', 
    '{"inventory_discrepancy_min": 1, "days_since_inbound": 30, "warehouse_confirmed": true}',
    '{"create_claim": true, "priority": "normal", "auto_file": false}', 100),
('lost_inventory_evidence', 'lost_inventory', 'evidence_requirement',
    '{}',
    '{"required": ["invoice"], "recommended": ["pod", "tracking"]}', 90),
('damaged_item_detection', 'damaged_inventory', 'detection',
    '{"damage_reported": true, "quantity_min": 1}',
    '{"create_claim": true, "priority": "high", "auto_file": false}', 100),
('overcharge_detection', 'overcharge', 'detection',
    '{"fee_discrepancy_min": 0.01, "calculate_expected": true}',
    '{"create_claim": true, "priority": "normal", "auto_file": true}', 80)
ON CONFLICT (rule_name) DO NOTHING;

-- ============================================
-- GRANTS
-- ============================================

GRANT SELECT, INSERT, UPDATE, DELETE ON schema_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON schema_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON evidence_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rejection_patterns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_rejections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flag_evaluations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flag_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON manual_review_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON analyst_corrections TO authenticated;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE schema_changes IS 'Layer 1: Tracks SP-API schema changes detected by monitoring';
COMMENT ON TABLE schema_snapshots IS 'Layer 1: Stores SP-API schema snapshots for comparison';
COMMENT ON TABLE claim_rules IS 'Layer 2: Hot-updatable claim rules (no code changes needed)';
COMMENT ON TABLE evidence_mappings IS 'Layer 2: Evidence requirements per claim type';
COMMENT ON TABLE rejection_patterns IS 'Layer 5: Categorized rejection patterns from Amazon';
COMMENT ON TABLE claim_rejections IS 'Layer 5: Individual claim rejections for learning';
COMMENT ON TABLE feature_flags IS 'Layer 6: Gradual rollout feature flags';
COMMENT ON TABLE feature_flag_evaluations IS 'Layer 6: History of flag evaluations';
COMMENT ON TABLE feature_flag_metrics IS 'Layer 6: Metrics tracked per feature flag';
COMMENT ON TABLE manual_review_queue IS 'Layer 7: Cases flagged for human review';
COMMENT ON TABLE analyst_corrections IS 'Layer 7: Corrections made by analysts';
