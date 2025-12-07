-- Migration: Add Learning Worker Support (Agent 11)
-- Creates tables for agent event logging, learning metrics, and insights

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create agent_events table for event-level logging from all agents
CREATE TABLE IF NOT EXISTS agent_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    agent TEXT NOT NULL CHECK (agent IN (
        'evidence_ingestion',
        'document_parsing',
        'evidence_matching',
        'refund_filing',
        'recoveries',
        'billing',
        'learning'
    )),
    event_type TEXT NOT NULL,
    success BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create learning_metrics table for model performance tracking
CREATE TABLE IF NOT EXISTS learning_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT,
    agent TEXT,
    metric_name TEXT NOT NULL,
    metric_value DECIMAL(10,4) NOT NULL,
    metric_type TEXT NOT NULL CHECK (metric_type IN (
        'success_rate',
        'precision',
        'recall',
        'accuracy',
        'f1_score',
        'threshold',
        'model_version'
    )),
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create threshold_optimizations table for threshold update history
CREATE TABLE IF NOT EXISTS threshold_optimizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    threshold_type TEXT NOT NULL CHECK (threshold_type IN (
        'auto_submit',
        'smart_prompt',
        'hold'
    )),
    old_value DECIMAL(5,4) NOT NULL,
    new_value DECIMAL(5,4) NOT NULL,
    reason TEXT,
    expected_improvement DECIMAL(5,4),
    actual_improvement DECIMAL(5,4),
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create model_retraining_history table for retraining records
CREATE TABLE IF NOT EXISTS model_retraining_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN (
        'scheduled',
        'rejection_threshold',
        'success_rate_threshold',
        'manual'
    )),
    old_model_version TEXT,
    new_model_version TEXT,
    old_accuracy DECIMAL(5,4),
    new_accuracy DECIMAL(5,4),
    improvement DECIMAL(5,4),
    training_samples INTEGER,
    event_count INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'training',
        'completed',
        'failed'
    )),
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create learning_insights table for generated insights
CREATE TABLE IF NOT EXISTS learning_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    insights JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_agent_events_user_id ON agent_events(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON agent_events(agent);
CREATE INDEX IF NOT EXISTS idx_agent_events_event_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_success ON agent_events(success);
CREATE INDEX IF NOT EXISTS idx_agent_events_created_at ON agent_events(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_user_agent ON agent_events(user_id, agent);
CREATE INDEX IF NOT EXISTS idx_agent_events_user_created ON agent_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_metrics_user_id ON learning_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_metrics_agent ON learning_metrics(agent);
CREATE INDEX IF NOT EXISTS idx_learning_metrics_metric_name ON learning_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_learning_metrics_created_at ON learning_metrics(created_at);

CREATE INDEX IF NOT EXISTS idx_threshold_optimizations_user_id ON threshold_optimizations(user_id);
CREATE INDEX IF NOT EXISTS idx_threshold_optimizations_threshold_type ON threshold_optimizations(threshold_type);
CREATE INDEX IF NOT EXISTS idx_threshold_optimizations_applied_at ON threshold_optimizations(applied_at);

CREATE INDEX IF NOT EXISTS idx_model_retraining_history_user_id ON model_retraining_history(user_id);
CREATE INDEX IF NOT EXISTS idx_model_retraining_history_status ON model_retraining_history(status);
CREATE INDEX IF NOT EXISTS idx_model_retraining_history_started_at ON model_retraining_history(started_at);

CREATE INDEX IF NOT EXISTS idx_learning_insights_user_id ON learning_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_insights_generated_at ON learning_insights(generated_at);

-- Enable Row Level Security (RLS)
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE threshold_optimizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_retraining_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_insights ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (drop existing if they exist, then recreate)
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Users can view their own agent events" ON agent_events;
  DROP POLICY IF EXISTS "Users can view their own learning metrics" ON learning_metrics;
  DROP POLICY IF EXISTS "Users can view their own threshold optimizations" ON threshold_optimizations;
  DROP POLICY IF EXISTS "Users can view their own retraining history" ON model_retraining_history;
  DROP POLICY IF EXISTS "Users can view their own learning insights" ON learning_insights;
END $$;

-- Create RLS policies with explicit type casting
CREATE POLICY "Users can view their own agent events" ON agent_events
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can view their own learning metrics" ON learning_metrics
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can view their own threshold optimizations" ON threshold_optimizations
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can view their own retraining history" ON model_retraining_history
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can view their own learning insights" ON learning_insights
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

-- Add comments
COMMENT ON TABLE agent_events IS 'Event-level logging from all agents (4-10) for continuous learning';
COMMENT ON COLUMN agent_events.agent IS 'Agent type: evidence_ingestion, document_parsing, evidence_matching, refund_filing, recoveries, billing';
COMMENT ON COLUMN agent_events.event_type IS 'Type of event (e.g., ingestion_completed, parsing_failed, case_approved)';
COMMENT ON COLUMN agent_events.metadata IS 'Rich metadata: timestamps, confidence scores, errors, outcomes, performance metrics';

COMMENT ON TABLE learning_metrics IS 'Model performance metrics and success rates per agent';
COMMENT ON COLUMN learning_metrics.metric_type IS 'Type of metric: success_rate, precision, recall, accuracy, f1_score, threshold, model_version';

COMMENT ON TABLE threshold_optimizations IS 'History of threshold adjustments for dynamic optimization';
COMMENT ON COLUMN threshold_optimizations.threshold_type IS 'Type of threshold: auto_submit, smart_prompt, hold';

COMMENT ON TABLE model_retraining_history IS 'Records of model retraining triggered by learning worker';
COMMENT ON COLUMN model_retraining_history.trigger_type IS 'What triggered retraining: scheduled, rejection_threshold, success_rate_threshold, manual';

COMMENT ON TABLE learning_insights IS 'Generated insights and recommendations for users';

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON threshold_optimizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON model_retraining_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_insights TO authenticated;

-- Verify the tables were created successfully
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name IN ('agent_events', 'learning_metrics', 'threshold_optimizations', 'model_retraining_history', 'learning_insights')
ORDER BY table_name, ordinal_position;

