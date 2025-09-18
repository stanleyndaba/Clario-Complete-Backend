-- Feature Flags & Canary Deployments Database Schema
-- Phase 8: Feature flags, canary deployments, and rollback management

-- Create ENUM types for feature flags and canary deployments
CREATE TYPE feature_flag_type AS ENUM (
    'boolean',
    'percentage',
    'user_list',
    'environment',
    'experiment'
);

CREATE TYPE feature_flag_status AS ENUM (
    'active',
    'inactive',
    'canary',
    'rolling_back',
    'rolled_back'
);

CREATE TYPE rollout_strategy AS ENUM (
    'all_users',
    'percentage',
    'user_list',
    'environment',
    'gradual'
);

CREATE TYPE canary_status AS ENUM (
    'pending',
    'running',
    'monitoring',
    'promoted',
    'rolled_back',
    'failed'
);

CREATE TYPE canary_strategy AS ENUM (
    'percentage',
    'user_list',
    'environment',
    'gradual',
    'a_b_test'
);

CREATE TYPE rollback_type AS ENUM (
    'automatic',
    'manual',
    'scheduled',
    'emergency'
);

CREATE TYPE rollback_status AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'failed',
    'cancelled'
);

CREATE TYPE rollback_scope AS ENUM (
    'feature_flag',
    'canary_deployment',
    'system_wide',
    'user_group',
    'environment'
);

-- Feature flags table
CREATE TABLE IF NOT EXISTS feature_flags (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    flag_type feature_flag_type NOT NULL,
    status feature_flag_status NOT NULL DEFAULT 'inactive',
    rollout_strategy rollout_strategy NOT NULL DEFAULT 'all_users',
    rollout_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.0,
    target_users JSONB NOT NULL DEFAULT '[]'::jsonb,
    target_environments JSONB NOT NULL DEFAULT '[]'::jsonb,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Feature flag evaluations table
CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id VARCHAR(255) NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    environment VARCHAR(100) NOT NULL DEFAULT 'production',
    enabled BOOLEAN NOT NULL,
    variant VARCHAR(255),
    reason VARCHAR(255) NOT NULL,
    evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Canary deployments table
CREATE TABLE IF NOT EXISTS canary_deployments (
    id VARCHAR(255) PRIMARY KEY,
    feature_flag_id VARCHAR(255) NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    strategy canary_strategy NOT NULL,
    target_percentage DECIMAL(5,2) NOT NULL DEFAULT 10.0,
    target_users JSONB NOT NULL DEFAULT '[]'::jsonb,
    target_environments JSONB NOT NULL DEFAULT '[]'::jsonb,
    monitoring_duration_hours INTEGER NOT NULL DEFAULT 24,
    success_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    rollback_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    status canary_status NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Canary metrics table
CREATE TABLE IF NOT EXISTS canary_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id VARCHAR(255) NOT NULL REFERENCES canary_deployments(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    success_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0,
    error_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0,
    response_time_ms DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    throughput_per_second DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    user_satisfaction DECIMAL(3,2),
    business_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    system_health JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Rollback plans table
CREATE TABLE IF NOT EXISTS rollback_plans (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rollback_type rollback_type NOT NULL,
    scope rollback_scope NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    rollback_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    rollback_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Rollback executions table
CREATE TABLE IF NOT EXISTS rollback_executions (
    id VARCHAR(255) PRIMARY KEY,
    plan_id VARCHAR(255) NOT NULL REFERENCES rollback_plans(id) ON DELETE CASCADE,
    status rollback_status NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    executed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    execution_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Feature flag history table
CREATE TABLE IF NOT EXISTS feature_flag_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_id VARCHAR(255) NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_feature_flags_name ON feature_flags(name);
CREATE INDEX IF NOT EXISTS idx_feature_flags_status ON feature_flags(status);
CREATE INDEX IF NOT EXISTS idx_feature_flags_flag_type ON feature_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_feature_flags_created_at ON feature_flags(created_at);
CREATE INDEX IF NOT EXISTS idx_feature_flags_target_users_gin ON feature_flags USING GIN(target_users);
CREATE INDEX IF NOT EXISTS idx_feature_flags_target_environments_gin ON feature_flags USING GIN(target_environments);
CREATE INDEX IF NOT EXISTS idx_feature_flags_config_gin ON feature_flags USING GIN(config);

CREATE INDEX IF NOT EXISTS idx_feature_flag_evaluations_flag_id ON feature_flag_evaluations(flag_id);
CREATE INDEX IF NOT EXISTS idx_feature_flag_evaluations_user_id ON feature_flag_evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_feature_flag_evaluations_environment ON feature_flag_evaluations(environment);
CREATE INDEX IF NOT EXISTS idx_feature_flag_evaluations_evaluated_at ON feature_flag_evaluations(evaluated_at);
CREATE INDEX IF NOT EXISTS idx_feature_flag_evaluations_enabled ON feature_flag_evaluations(enabled);

CREATE INDEX IF NOT EXISTS idx_canary_deployments_feature_flag_id ON canary_deployments(feature_flag_id);
CREATE INDEX IF NOT EXISTS idx_canary_deployments_status ON canary_deployments(status);
CREATE INDEX IF NOT EXISTS idx_canary_deployments_strategy ON canary_deployments(strategy);
CREATE INDEX IF NOT EXISTS idx_canary_deployments_created_at ON canary_deployments(created_at);
CREATE INDEX IF NOT EXISTS idx_canary_deployments_started_at ON canary_deployments(started_at);

CREATE INDEX IF NOT EXISTS idx_canary_metrics_deployment_id ON canary_metrics(deployment_id);
CREATE INDEX IF NOT EXISTS idx_canary_metrics_timestamp ON canary_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_canary_metrics_success_rate ON canary_metrics(success_rate);
CREATE INDEX IF NOT EXISTS idx_canary_metrics_error_rate ON canary_metrics(error_rate);

CREATE INDEX IF NOT EXISTS idx_rollback_plans_rollback_type ON rollback_plans(rollback_type);
CREATE INDEX IF NOT EXISTS idx_rollback_plans_scope ON rollback_plans(scope);
CREATE INDEX IF NOT EXISTS idx_rollback_plans_target_id ON rollback_plans(target_id);
CREATE INDEX IF NOT EXISTS idx_rollback_plans_status ON rollback_plans(status);

CREATE INDEX IF NOT EXISTS idx_rollback_executions_plan_id ON rollback_executions(plan_id);
CREATE INDEX IF NOT EXISTS idx_rollback_executions_status ON rollback_executions(status);
CREATE INDEX IF NOT EXISTS idx_rollback_executions_executed_by ON rollback_executions(executed_by);
CREATE INDEX IF NOT EXISTS idx_rollback_executions_started_at ON rollback_executions(started_at);

CREATE INDEX IF NOT EXISTS idx_feature_flag_history_flag_id ON feature_flag_history(flag_id);
CREATE INDEX IF NOT EXISTS idx_feature_flag_history_action ON feature_flag_history(action);
CREATE INDEX IF NOT EXISTS idx_feature_flag_history_changed_at ON feature_flag_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_feature_flag_history_changed_by ON feature_flag_history(changed_by);

-- Add updated_at triggers
CREATE TRIGGER update_feature_flags_updated_at 
    BEFORE UPDATE ON feature_flags 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create functions for feature flag operations
CREATE OR REPLACE FUNCTION evaluate_feature_flag(
    p_flag_name VARCHAR(255),
    p_user_id UUID,
    p_environment VARCHAR(100) DEFAULT 'production'
)
RETURNS TABLE (
    enabled BOOLEAN,
    variant VARCHAR(255),
    reason VARCHAR(255)
) AS $$
DECLARE
    flag_record RECORD;
    user_hash INTEGER;
    rollout_percentage DECIMAL(5,2);
BEGIN
    -- Get the feature flag
    SELECT * INTO flag_record
    FROM feature_flags
    WHERE name = p_flag_name
    AND status IN ('active', 'canary');
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL, 'flag_not_found';
        RETURN;
    END IF;
    
    -- Check environment targeting
    IF flag_record.target_environments IS NOT NULL 
       AND NOT (p_environment = ANY(SELECT jsonb_array_elements_text(flag_record.target_environments))) THEN
        RETURN QUERY SELECT FALSE, NULL, 'environment_not_targeted';
        RETURN;
    END IF;
    
    -- Check user targeting
    IF flag_record.target_users IS NOT NULL 
       AND NOT (p_user_id::text = ANY(SELECT jsonb_array_elements_text(flag_record.target_users))) THEN
        RETURN QUERY SELECT FALSE, NULL, 'user_not_targeted';
        RETURN;
    END IF;
    
    -- Evaluate based on rollout strategy
    CASE flag_record.rollout_strategy
        WHEN 'all_users' THEN
            RETURN QUERY SELECT TRUE, NULL, 'all_users';
        WHEN 'percentage' THEN
            user_hash := abs(hashtext(p_user_id::text)) % 100;
            IF user_hash < flag_record.rollout_percentage THEN
                RETURN QUERY SELECT TRUE, NULL, 'percentage_rollout';
            ELSE
                RETURN QUERY SELECT FALSE, NULL, 'percentage_rollout';
            END IF;
        WHEN 'user_list' THEN
            IF p_user_id::text = ANY(SELECT jsonb_array_elements_text(flag_record.target_users)) THEN
                RETURN QUERY SELECT TRUE, NULL, 'user_list';
            ELSE
                RETURN QUERY SELECT FALSE, NULL, 'user_list';
            END IF;
        WHEN 'environment' THEN
            IF p_environment = ANY(SELECT jsonb_array_elements_text(flag_record.target_environments)) THEN
                RETURN QUERY SELECT TRUE, NULL, 'environment';
            ELSE
                RETURN QUERY SELECT FALSE, NULL, 'environment';
            END IF;
        WHEN 'gradual' THEN
            -- Gradual rollout based on time since creation
            rollout_percentage := LEAST(flag_record.rollout_percentage, 
                EXTRACT(EPOCH FROM (NOW() - flag_record.created_at)) / 3600 * 10);
            user_hash := abs(hashtext(p_user_id::text)) % 100;
            IF user_hash < rollout_percentage THEN
                RETURN QUERY SELECT TRUE, NULL, 'gradual_rollout';
            ELSE
                RETURN QUERY SELECT FALSE, NULL, 'gradual_rollout';
            END IF;
        ELSE
            RETURN QUERY SELECT FALSE, NULL, 'unknown_strategy';
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Create function to log feature flag evaluations
CREATE OR REPLACE FUNCTION log_feature_flag_evaluation(
    p_flag_id VARCHAR(255),
    p_user_id UUID,
    p_environment VARCHAR(100),
    p_enabled BOOLEAN,
    p_variant VARCHAR(255),
    p_reason VARCHAR(255),
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    evaluation_id UUID;
BEGIN
    evaluation_id := uuid_generate_v4();
    
    INSERT INTO feature_flag_evaluations (
        id, flag_id, user_id, environment, enabled, variant, reason, metadata
    ) VALUES (
        evaluation_id, p_flag_id, p_user_id, p_environment, p_enabled, p_variant, p_reason, p_metadata
    );
    
    RETURN evaluation_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to get canary deployment metrics
CREATE OR REPLACE FUNCTION get_canary_metrics(
    p_deployment_id VARCHAR(255),
    p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    time_bucket TIMESTAMP WITH TIME ZONE,
    avg_success_rate DECIMAL(5,4),
    avg_error_rate DECIMAL(5,4),
    avg_response_time_ms DECIMAL(10,2),
    avg_throughput_per_second DECIMAL(10,2),
    sample_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        DATE_TRUNC('hour', timestamp) as time_bucket,
        AVG(success_rate) as avg_success_rate,
        AVG(error_rate) as avg_error_rate,
        AVG(response_time_ms) as avg_response_time_ms,
        AVG(throughput_per_second) as avg_throughput_per_second,
        COUNT(*) as sample_count
    FROM canary_metrics
    WHERE deployment_id = p_deployment_id
    AND timestamp >= NOW() - INTERVAL '1 hour' * p_hours
    GROUP BY DATE_TRUNC('hour', timestamp)
    ORDER BY time_bucket DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function to check rollback criteria
CREATE OR REPLACE FUNCTION check_rollback_criteria(
    p_target_id VARCHAR(255),
    p_scope rollback_scope
)
RETURNS BOOLEAN AS $$
DECLARE
    error_rate DECIMAL(5,4);
    success_rate DECIMAL(5,4);
    response_time_ms DECIMAL(10,2);
BEGIN
    -- Get recent metrics (last 5 minutes)
    SELECT 
        AVG(CASE WHEN name = 'api_error_rate' THEN value::numeric ELSE 0 END),
        AVG(CASE WHEN name = 'api_success_rate' THEN value::numeric ELSE 0 END),
        AVG(CASE WHEN name = 'api_response_time' THEN value::numeric ELSE 0 END)
    INTO error_rate, success_rate, response_time_ms
    FROM metrics_data
    WHERE created_at >= NOW() - INTERVAL '5 minutes'
    AND category = 'api';
    
    -- Default rollback criteria
    IF error_rate > 0.10 OR success_rate < 0.80 OR response_time_ms > 5000 THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Insert default feature flags
INSERT INTO feature_flags (id, name, description, flag_type, status, rollout_strategy, target_environments) VALUES
('auto_submit_enabled', 'Auto Submit Enabled', 'Enable automatic dispute submission for high-confidence matches', 'boolean', 'inactive', 'environment', '["development", "staging"]'),
('smart_prompts_enabled', 'Smart Prompts Enabled', 'Enable smart prompts for ambiguous evidence matches', 'boolean', 'inactive', 'environment', '["development", "staging"]'),
('proof_packets_enabled', 'Proof Packets Enabled', 'Enable automatic proof packet generation', 'boolean', 'inactive', 'environment', '["development", "staging"]'),
('canary_auto_submit', 'Canary Auto Submit', 'Canary deployment for auto-submit feature', 'percentage', 'inactive', 'percentage', '["production"]'),
('canary_smart_prompts', 'Canary Smart Prompts', 'Canary deployment for smart prompts feature', 'percentage', 'inactive', 'percentage', '["production"]')
ON CONFLICT (id) DO NOTHING;

-- Insert default rollback plans
INSERT INTO rollback_plans (id, name, description, rollback_type, scope, target_id, rollback_steps, rollback_criteria) VALUES
('emergency_auto_submit', 'Emergency Auto Submit Rollback', 'Emergency rollback for auto-submit feature', 'emergency', 'feature_flag', 'auto_submit_enabled', '[{"type": "disable_feature_flag", "config": {"flag_id": "auto_submit_enabled"}}]', '{"max_error_rate": 0.10, "min_success_rate": 0.80}'),
('emergency_smart_prompts', 'Emergency Smart Prompts Rollback', 'Emergency rollback for smart prompts feature', 'emergency', 'feature_flag', 'smart_prompts_enabled', '[{"type": "disable_feature_flag", "config": {"flag_id": "smart_prompts_enabled"}}]', '{"max_error_rate": 0.10, "min_success_rate": 0.80}'),
('emergency_system', 'Emergency System Rollback', 'Emergency system-wide rollback', 'emergency', 'system_wide', 'system', '[{"type": "restart_service", "config": {"service_name": "evidence_validator"}}, {"type": "restore_database", "config": {"backup_id": "latest"}}]', '{"max_error_rate": 0.20, "min_success_rate": 0.60}')
ON CONFLICT (id) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE feature_flags IS 'Feature flags configuration and management';
COMMENT ON TABLE feature_flag_evaluations IS 'Feature flag evaluation history and analytics';
COMMENT ON TABLE canary_deployments IS 'Canary deployment configurations and status';
COMMENT ON TABLE canary_metrics IS 'Canary deployment metrics and monitoring data';
COMMENT ON TABLE rollback_plans IS 'Rollback plans for different scenarios';
COMMENT ON TABLE rollback_executions IS 'Rollback execution history and status';
COMMENT ON TABLE feature_flag_history IS 'Feature flag change history and audit trail';

COMMENT ON COLUMN feature_flags.rollout_percentage IS 'Percentage of users to include in rollout (0-100)';
COMMENT ON COLUMN feature_flags.target_users IS 'Array of specific user IDs to target';
COMMENT ON COLUMN feature_flags.target_environments IS 'Array of environments to target';
COMMENT ON COLUMN feature_flags.config IS 'Feature-specific configuration data';

COMMENT ON COLUMN canary_deployments.target_percentage IS 'Percentage of users for canary deployment';
COMMENT ON COLUMN canary_deployments.success_criteria IS 'Criteria for successful canary deployment';
COMMENT ON COLUMN canary_deployments.rollback_criteria IS 'Criteria for automatic rollback';

COMMENT ON COLUMN rollback_plans.rollback_steps IS 'Array of steps to execute during rollback';
COMMENT ON COLUMN rollback_plans.rollback_criteria IS 'Criteria that trigger automatic rollback';

COMMENT ON COLUMN rollback_executions.execution_log IS 'Detailed log of rollback execution steps';
COMMENT ON COLUMN rollback_executions.error_message IS 'Error message if rollback failed';
