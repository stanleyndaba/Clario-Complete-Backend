-- Workflow Phase Audit Log Migration
-- Extends existing sync_progress table to track phase transitions for debugging and SLA monitoring
-- Uses existing sync_progress table - only adds missing columns

-- Add phase tracking columns to existing sync_progress table (if they don't exist)
DO $$ 
BEGIN
    -- Add phase_number column if it doesn't exist (maps to step, but for 7-phase workflow)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_progress' AND column_name = 'phase_number') THEN
        ALTER TABLE sync_progress ADD COLUMN phase_number INTEGER;
        COMMENT ON COLUMN sync_progress.phase_number IS 'Phase number for 7-phase workflow (1-7), maps to step';
    END IF;
    
    -- Add duration_ms for phase timing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_progress' AND column_name = 'duration_ms') THEN
        ALTER TABLE sync_progress ADD COLUMN duration_ms INTEGER;
        COMMENT ON COLUMN sync_progress.duration_ms IS 'Duration of phase in milliseconds';
    END IF;
    
    -- Add previous_phase for rollback tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_progress' AND column_name = 'previous_phase') THEN
        ALTER TABLE sync_progress ADD COLUMN previous_phase INTEGER;
        COMMENT ON COLUMN sync_progress.previous_phase IS 'Previous phase number for rollback tracking';
    END IF;
    
    -- Add error tracking columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_progress' AND column_name = 'error_message') THEN
        ALTER TABLE sync_progress ADD COLUMN error_message TEXT;
        COMMENT ON COLUMN sync_progress.error_message IS 'Error message if phase failed';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_progress' AND column_name = 'error_stack') THEN
        ALTER TABLE sync_progress ADD COLUMN error_stack TEXT;
        COMMENT ON COLUMN sync_progress.error_stack IS 'Full error stack trace if phase failed';
    END IF;
    
    -- Add rollback tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_progress' AND column_name = 'rollback_triggered') THEN
        ALTER TABLE sync_progress ADD COLUMN rollback_triggered BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN sync_progress.rollback_triggered IS 'Whether rollback was triggered for this phase';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'sync_progress' AND column_name = 'rollback_to_phase') THEN
        ALTER TABLE sync_progress ADD COLUMN rollback_to_phase INTEGER;
        COMMENT ON COLUMN sync_progress.rollback_to_phase IS 'Phase number to rollback to if rollback triggered';
    END IF;
END $$;

-- Add indexes for phase tracking (using existing sync_progress table)
CREATE INDEX IF NOT EXISTS idx_sync_progress_phase_number ON sync_progress(phase_number) WHERE phase_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sync_progress_rollback ON sync_progress(rollback_triggered) WHERE rollback_triggered = TRUE;
CREATE INDEX IF NOT EXISTS idx_sync_progress_phase_status ON sync_progress(phase_number, status) WHERE phase_number IS NOT NULL;

-- View for phase transition analytics (using existing sync_progress table)
CREATE OR REPLACE VIEW workflow_phase_analytics AS
SELECT 
    sync_id as workflow_id,
    user_id,
    phase_number,
    COUNT(*) as transition_count,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
    COUNT(CASE WHEN rollback_triggered = TRUE THEN 1 END) as rollback_count,
    AVG(duration_ms) as avg_duration_ms,
    MIN(duration_ms) as min_duration_ms,
    MAX(duration_ms) as max_duration_ms,
    MIN(created_at) as first_transition,
    MAX(updated_at) as last_transition
FROM sync_progress
WHERE phase_number IS NOT NULL
GROUP BY sync_id, user_id, phase_number;

-- View for SLA tracking (phases that took longer than expected) - using existing sync_progress table
CREATE OR REPLACE VIEW workflow_phase_sla_violations AS
SELECT 
    id,
    sync_id as workflow_id,
    user_id,
    phase_number,
    duration_ms,
    updated_at as timestamp,
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
FROM sync_progress
WHERE status = 'completed' 
    AND duration_ms IS NOT NULL
    AND phase_number IS NOT NULL
    AND (
        (phase_number = 1 AND duration_ms > 30000) OR
        (phase_number = 2 AND duration_ms > 60000) OR
        (phase_number = 3 AND duration_ms > 120000) OR
        (phase_number = 4 AND duration_ms > 90000) OR
        (phase_number = 5 AND duration_ms > 10000) OR
        (phase_number = 6 AND duration_ms > 15000) OR
        (phase_number = 7 AND duration_ms > 60000)
    );

