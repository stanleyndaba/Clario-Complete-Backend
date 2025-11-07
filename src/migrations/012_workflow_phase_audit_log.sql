-- Workflow Phase Audit Log Migration
-- Tracks all phase transitions for debugging and SLA monitoring

-- Workflow phase logs table
CREATE TABLE IF NOT EXISTS workflow_phase_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id VARCHAR(255) NOT NULL, -- Unique identifier for the workflow instance (sync_id, claim_id, etc.)
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phase_number INTEGER NOT NULL CHECK (phase_number >= 1 AND phase_number <= 7),
    status VARCHAR(50) NOT NULL DEFAULT 'started', -- started, completed, failed, rolled_back
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    duration_ms INTEGER, -- Duration in milliseconds (null if still running)
    previous_phase INTEGER, -- Previous phase number (for rollback tracking)
    error_message TEXT,
    error_stack TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    rollback_triggered BOOLEAN DEFAULT FALSE,
    rollback_to_phase INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_workflow_phase_logs_workflow_id ON workflow_phase_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_phase_logs_user_id ON workflow_phase_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_phase_logs_phase_number ON workflow_phase_logs(phase_number);
CREATE INDEX IF NOT EXISTS idx_workflow_phase_logs_status ON workflow_phase_logs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_phase_logs_timestamp ON workflow_phase_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_phase_logs_rollback ON workflow_phase_logs(rollback_triggered) WHERE rollback_triggered = TRUE;

-- Composite index for common queries (workflow status tracking)
CREATE INDEX IF NOT EXISTS idx_workflow_phase_logs_workflow_phase ON workflow_phase_logs(workflow_id, phase_number, timestamp DESC);

-- View for phase transition analytics
CREATE OR REPLACE VIEW workflow_phase_analytics AS
SELECT 
    workflow_id,
    user_id,
    phase_number,
    COUNT(*) as transition_count,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
    COUNT(CASE WHEN rollback_triggered = TRUE THEN 1 END) as rollback_count,
    AVG(duration_ms) as avg_duration_ms,
    MIN(duration_ms) as min_duration_ms,
    MAX(duration_ms) as max_duration_ms,
    MIN(timestamp) as first_transition,
    MAX(timestamp) as last_transition
FROM workflow_phase_logs
GROUP BY workflow_id, user_id, phase_number;

-- View for SLA tracking (phases that took longer than expected)
CREATE OR REPLACE VIEW workflow_phase_sla_violations AS
SELECT 
    id,
    workflow_id,
    user_id,
    phase_number,
    duration_ms,
    timestamp,
    CASE 
        WHEN phase_number = 1 AND duration_ms > 30000 THEN 'Phase 1 SLA violation (>30s)'
        WHEN phase_number = 2 AND duration_ms > 60000 THEN 'Phase 2 SLA violation (>60s)'
        WHEN phase_number = 3 AND duration_ms > 120000 THEN 'Phase 3 SLA violation (>120s)'
        WHEN phase_number = 4 AND duration_ms > 90000 THEN 'Phase 4 SLA violation (>90s)'
        WHEN phase_number = 5 AND duration_ms > 10000 THEN 'Phase 5 SLA violation (>10s)'
        WHEN phase_number = 6 AND duration_ms > 15000 THEN 'Phase 6 SLA violation (>15s)'
        WHEN phase_number = 7 AND duration_ms > 60000 THEN 'Phase 7 SLA violation (>60s)'
        ELSE NULL
    END as violation_reason
FROM workflow_phase_logs
WHERE status = 'completed' 
    AND duration_ms IS NOT NULL
    AND (
        (phase_number = 1 AND duration_ms > 30000) OR
        (phase_number = 2 AND duration_ms > 60000) OR
        (phase_number = 3 AND duration_ms > 120000) OR
        (phase_number = 4 AND duration_ms > 90000) OR
        (phase_number = 5 AND duration_ms > 10000) OR
        (phase_number = 6 AND duration_ms > 15000) OR
        (phase_number = 7 AND duration_ms > 60000)
    );

