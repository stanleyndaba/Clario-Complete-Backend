-- Analytics & Monitoring Database Schema
-- Phase 7: Real-time analytics, monitoring, and alerting infrastructure

-- Create ENUM types for analytics functionality
CREATE TYPE metric_type AS ENUM (
    'counter',
    'gauge',
    'histogram',
    'summary',
    'timer'
);

CREATE TYPE metric_category AS ENUM (
    'system',
    'user',
    'evidence',
    'dispute',
    'submission',
    'proof_packet',
    'prompt',
    'parser',
    'matching',
    'api',
    'websocket'
);

CREATE TYPE alert_severity AS ENUM (
    'info',
    'warning',
    'error',
    'critical'
);

CREATE TYPE alert_status AS ENUM (
    'active',
    'acknowledged',
    'resolved',
    'suppressed'
);

CREATE TYPE alert_condition AS ENUM (
    'gt',
    'lt',
    'eq',
    'ne',
    'gte',
    'lte',
    'contains',
    'not_contains'
);

-- Metrics data table
CREATE TABLE IF NOT EXISTS metrics_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    value TEXT NOT NULL, -- Store as text to handle different data types
    metric_type metric_type NOT NULL,
    category metric_category NOT NULL,
    labels JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Alert rules table
CREATE TABLE IF NOT EXISTS alert_rules (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    metric_name VARCHAR(255) NOT NULL,
    category metric_category NOT NULL,
    condition alert_condition NOT NULL,
    threshold DECIMAL(20,6) NOT NULL,
    severity alert_severity NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 5,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    labels JSONB NOT NULL DEFAULT '{}'::jsonb,
    notification_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id VARCHAR(255) PRIMARY KEY,
    rule_id VARCHAR(255) NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    severity alert_severity NOT NULL,
    status alert_status NOT NULL DEFAULT 'active',
    message TEXT NOT NULL,
    metric_value DECIMAL(20,6) NOT NULL,
    threshold DECIMAL(20,6) NOT NULL,
    triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Dashboard configurations table
CREATE TABLE IF NOT EXISTS dashboard_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- System health snapshots table
CREATE TABLE IF NOT EXISTS system_health_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cpu_usage_percent DECIMAL(5,2),
    memory_usage_percent DECIMAL(5,2),
    disk_usage_percent DECIMAL(5,2),
    active_connections INTEGER,
    response_time_ms DECIMAL(10,2),
    error_rate DECIMAL(5,4),
    throughput_per_second DECIMAL(10,2),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Performance benchmarks table
CREATE TABLE IF NOT EXISTS performance_benchmarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operation_name VARCHAR(255) NOT NULL,
    duration_ms DECIMAL(10,2) NOT NULL,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_metrics_data_name ON metrics_data(name);
CREATE INDEX IF NOT EXISTS idx_metrics_data_category ON metrics_data(category);
CREATE INDEX IF NOT EXISTS idx_metrics_data_metric_type ON metrics_data(metric_type);
CREATE INDEX IF NOT EXISTS idx_metrics_data_user_id ON metrics_data(user_id);
CREATE INDEX IF NOT EXISTS idx_metrics_data_timestamp ON metrics_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_data_labels_gin ON metrics_data USING GIN(labels);
CREATE INDEX IF NOT EXISTS idx_metrics_data_metadata_gin ON metrics_data USING GIN(metadata);

CREATE INDEX IF NOT EXISTS idx_alert_rules_metric_name ON alert_rules(metric_name);
CREATE INDEX IF NOT EXISTS idx_alert_rules_category ON alert_rules(category);
CREATE INDEX IF NOT EXISTS idx_alert_rules_severity ON alert_rules(severity);
CREATE INDEX IF NOT EXISTS idx_alert_rules_is_enabled ON alert_rules(is_enabled);
CREATE INDEX IF NOT EXISTS idx_alert_rules_labels_gin ON alert_rules USING GIN(labels);

CREATE INDEX IF NOT EXISTS idx_alerts_rule_id ON alerts(rule_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at ON alerts(triggered_at);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged_by ON alerts(acknowledged_by);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved_by ON alerts(resolved_by);

CREATE INDEX IF NOT EXISTS idx_dashboard_configs_name ON dashboard_configs(name);
CREATE INDEX IF NOT EXISTS idx_dashboard_configs_is_public ON dashboard_configs(is_public);
CREATE INDEX IF NOT EXISTS idx_dashboard_configs_created_by ON dashboard_configs(created_by);
CREATE INDEX IF NOT EXISTS idx_dashboard_configs_config_gin ON dashboard_configs USING GIN(config);

CREATE INDEX IF NOT EXISTS idx_system_health_snapshots_created_at ON system_health_snapshots(created_at);

CREATE INDEX IF NOT EXISTS idx_performance_benchmarks_operation_name ON performance_benchmarks(operation_name);
CREATE INDEX IF NOT EXISTS idx_performance_benchmarks_success ON performance_benchmarks(success);
CREATE INDEX IF NOT EXISTS idx_performance_benchmarks_user_id ON performance_benchmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_performance_benchmarks_created_at ON performance_benchmarks(created_at);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_metrics_data_category_name_timestamp ON metrics_data(category, name, timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_data_user_timestamp ON metrics_data(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_alerts_status_triggered_at ON alerts(status, triggered_at);
CREATE INDEX IF NOT EXISTS idx_alerts_severity_status ON alerts(severity, status);

-- Add updated_at triggers
CREATE TRIGGER update_alert_rules_updated_at 
    BEFORE UPDATE ON alert_rules 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboard_configs_updated_at 
    BEFORE UPDATE ON dashboard_configs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create functions for analytics operations
CREATE OR REPLACE FUNCTION get_metric_statistics(
    p_metric_name VARCHAR(255),
    p_category metric_category,
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
    count BIGINT,
    avg_value DECIMAL(20,6),
    min_value DECIMAL(20,6),
    max_value DECIMAL(20,6),
    sum_value DECIMAL(20,6)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as count,
        AVG(value::numeric) as avg_value,
        MIN(value::numeric) as min_value,
        MAX(value::numeric) as max_value,
        SUM(value::numeric) as sum_value
    FROM metrics_data
    WHERE name = p_metric_name
    AND category = p_category
    AND timestamp >= p_start_time
    AND timestamp <= p_end_time;
END;
$$ LANGUAGE plpgsql;

-- Create function to get system health trends
CREATE OR REPLACE FUNCTION get_system_health_trends(
    p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    time_bucket TIMESTAMP WITH TIME ZONE,
    avg_cpu DECIMAL(5,2),
    avg_memory DECIMAL(5,2),
    avg_response_time DECIMAL(10,2),
    avg_error_rate DECIMAL(5,4),
    sample_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        DATE_TRUNC('hour', created_at) as time_bucket,
        AVG(cpu_usage_percent) as avg_cpu,
        AVG(memory_usage_percent) as avg_memory,
        AVG(response_time_ms) as avg_response_time,
        AVG(error_rate) as avg_error_rate,
        COUNT(*) as sample_count
    FROM system_health_snapshots
    WHERE created_at >= NOW() - INTERVAL '1 hour' * p_hours
    GROUP BY DATE_TRUNC('hour', created_at)
    ORDER BY time_bucket DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function to get performance benchmarks
CREATE OR REPLACE FUNCTION get_performance_benchmarks(
    p_operation_name VARCHAR(255),
    p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
    operation_name VARCHAR(255),
    avg_duration_ms DECIMAL(10,2),
    min_duration_ms DECIMAL(10,2),
    max_duration_ms DECIMAL(10,2),
    success_rate DECIMAL(5,4),
    total_operations BIGINT,
    error_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        operation_name,
        AVG(duration_ms) as avg_duration_ms,
        MIN(duration_ms) as min_duration_ms,
        MAX(duration_ms) as max_duration_ms,
        AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) as success_rate,
        COUNT(*) as total_operations,
        COUNT(*) FILTER (WHERE NOT success) as error_count
    FROM performance_benchmarks
    WHERE operation_name = p_operation_name
    AND created_at >= NOW() - INTERVAL '1 hour' * p_hours
    GROUP BY operation_name;
END;
$$ LANGUAGE plpgsql;

-- Create function to clean up old metrics data
CREATE OR REPLACE FUNCTION cleanup_old_metrics(
    p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM metrics_data 
    WHERE timestamp < NOW() - INTERVAL '1 day' * p_retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to clean up old alerts
CREATE OR REPLACE FUNCTION cleanup_old_alerts(
    p_retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM alerts 
    WHERE triggered_at < NOW() - INTERVAL '1 day' * p_retention_days
    AND status = 'resolved';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Insert default alert rules
INSERT INTO alert_rules (id, name, description, metric_name, category, condition, threshold, severity, duration_minutes, notification_channels) VALUES
('high_cpu_usage', 'High CPU Usage', 'CPU usage exceeds 80%', 'cpu_usage_percent', 'system', 'gt', 80.0, 'warning', 5, '["log", "email"]'),
('high_memory_usage', 'High Memory Usage', 'Memory usage exceeds 90%', 'memory_usage_percent', 'system', 'gt', 90.0, 'error', 5, '["log", "email", "slack"]'),
('slow_api_response', 'Slow API Response', 'API response time exceeds 5 seconds', 'api_response_time', 'api', 'gt', 5000.0, 'warning', 3, '["log", "email"]'),
('high_error_rate', 'High Error Rate', 'Error rate exceeds 5%', 'error_rate', 'system', 'gt', 0.05, 'error', 5, '["log", "email", "slack"]'),
('low_parsing_success', 'Low Parsing Success Rate', 'Document parsing success rate below 85%', 'parsing_success_rate', 'parser', 'lt', 85.0, 'warning', 10, '["log", "email"]'),
('low_submission_success', 'Low Submission Success Rate', 'Dispute submission success rate below 90%', 'submission_success_rate', 'submission', 'lt', 90.0, 'error', 5, '["log", "email", "slack"]')
ON CONFLICT (id) DO NOTHING;

-- Insert default dashboard configurations
INSERT INTO dashboard_configs (id, name, description, config, is_public, created_by) VALUES
('system_overview', 'System Overview', 'High-level system health and performance metrics', '{"widgets": [{"id": "cpu_usage", "type": "gauge", "title": "CPU Usage"}, {"id": "memory_usage", "type": "gauge", "title": "Memory Usage"}, {"id": "api_response_times", "type": "line_chart", "title": "API Response Times"}]}', TRUE, NULL),
('evidence_processing', 'Evidence Processing', 'Evidence ingestion and processing metrics', '{"widgets": [{"id": "documents_processed", "type": "line_chart", "title": "Documents Processed"}, {"id": "parsing_success_rate", "type": "gauge", "title": "Parsing Success Rate"}, {"id": "matching_confidence", "type": "histogram", "title": "Matching Confidence Distribution"}]}', TRUE, NULL),
('dispute_submissions', 'Dispute Submissions', 'Dispute submission and processing metrics', '{"widgets": [{"id": "submissions_timeline", "type": "line_chart", "title": "Submissions Timeline"}, {"id": "submission_success_rate", "type": "gauge", "title": "Submission Success Rate"}, {"id": "auto_vs_manual", "type": "pie_chart", "title": "Auto vs Manual Submissions"}]}', TRUE, NULL)
ON CONFLICT (id) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE metrics_data IS 'Real-time metrics data for analytics and monitoring';
COMMENT ON TABLE alert_rules IS 'Alert rules configuration for monitoring';
COMMENT ON TABLE alerts IS 'Active and historical alerts';
COMMENT ON TABLE dashboard_configs IS 'Dashboard configuration and layouts';
COMMENT ON TABLE system_health_snapshots IS 'Periodic system health snapshots';
COMMENT ON TABLE performance_benchmarks IS 'Performance benchmark data for operations';

COMMENT ON COLUMN metrics_data.value IS 'Metric value stored as text to handle different data types';
COMMENT ON COLUMN metrics_data.labels IS 'Key-value labels for metric dimensions';
COMMENT ON COLUMN metrics_data.metadata IS 'Additional metadata for the metric';

COMMENT ON COLUMN alert_rules.threshold IS 'Threshold value for triggering alerts';
COMMENT ON COLUMN alert_rules.duration_minutes IS 'Duration in minutes before alert is considered stale';
COMMENT ON COLUMN alert_rules.notification_channels IS 'Array of notification channels for this alert rule';

COMMENT ON COLUMN alerts.metric_value IS 'Actual metric value when alert was triggered';
COMMENT ON COLUMN alerts.threshold IS 'Threshold value that was exceeded';
COMMENT ON COLUMN alerts.metadata IS 'Additional context and metadata for the alert';

COMMENT ON COLUMN dashboard_configs.config IS 'JSON configuration for dashboard layout and widgets';
COMMENT ON COLUMN dashboard_configs.is_public IS 'Whether the dashboard is publicly accessible';

COMMENT ON COLUMN system_health_snapshots.cpu_usage_percent IS 'CPU usage percentage at snapshot time';
COMMENT ON COLUMN system_health_snapshots.memory_usage_percent IS 'Memory usage percentage at snapshot time';
COMMENT ON COLUMN system_health_snapshots.error_rate IS 'Error rate as decimal (0.0 to 1.0)';

COMMENT ON COLUMN performance_benchmarks.operation_name IS 'Name of the operation being benchmarked';
COMMENT ON COLUMN performance_benchmarks.duration_ms IS 'Operation duration in milliseconds';
COMMENT ON COLUMN performance_benchmarks.success IS 'Whether the operation succeeded';
