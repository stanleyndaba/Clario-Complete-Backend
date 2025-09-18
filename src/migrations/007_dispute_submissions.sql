-- Dispute Submissions Database Schema
-- Handles Amazon SP-API dispute submission tracking and management

-- Create ENUM types for submission functionality
CREATE TYPE submission_status AS ENUM (
    'pending',
    'submitted',
    'approved',
    'rejected',
    'failed',
    'retrying',
    'cancelled'
);

-- Dispute submissions table
CREATE TABLE IF NOT EXISTS dispute_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    submission_id VARCHAR(255), -- Amazon SP-API submission ID
    amazon_case_id VARCHAR(255), -- Amazon case ID
    order_id VARCHAR(255) NOT NULL,
    asin VARCHAR(50),
    sku VARCHAR(100),
    claim_type VARCHAR(100) NOT NULL,
    amount_claimed DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    status submission_status NOT NULL DEFAULT 'pending',
    confidence_score DECIMAL(5,4),
    submission_timestamp TIMESTAMP WITH TIME ZONE,
    resolution_timestamp TIMESTAMP WITH TIME ZONE,
    amount_approved DECIMAL(10,2),
    resolution_notes TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_retry_at TIMESTAMP WITH TIME ZONE,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Submission evidence links table
CREATE TABLE IF NOT EXISTS submission_evidence_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES dispute_submissions(id) ON DELETE CASCADE,
    evidence_document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
    evidence_type VARCHAR(50) NOT NULL DEFAULT 'supporting_document',
    evidence_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Submission status history table
CREATE TABLE IF NOT EXISTS submission_status_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES dispute_submissions(id) ON DELETE CASCADE,
    status submission_status NOT NULL,
    status_reason TEXT,
    amazon_response JSONB,
    changed_by UUID REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_user_id ON dispute_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_submission_id ON dispute_submissions(submission_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_amazon_case_id ON dispute_submissions(amazon_case_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_order_id ON dispute_submissions(order_id);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_status ON dispute_submissions(status);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_confidence_score ON dispute_submissions(confidence_score);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_submission_timestamp ON dispute_submissions(submission_timestamp);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_created_at ON dispute_submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_next_retry_at ON dispute_submissions(next_retry_at);

CREATE INDEX IF NOT EXISTS idx_submission_evidence_links_submission_id ON submission_evidence_links(submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_evidence_links_evidence_document_id ON submission_evidence_links(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_submission_evidence_links_evidence_type ON submission_evidence_links(evidence_type);

CREATE INDEX IF NOT EXISTS idx_submission_status_history_submission_id ON submission_status_history(submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_status_history_status ON submission_status_history(status);
CREATE INDEX IF NOT EXISTS idx_submission_status_history_changed_at ON submission_status_history(changed_at);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_metadata_gin ON dispute_submissions USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_submission_status_history_amazon_response_gin ON submission_status_history USING GIN(amazon_response);
CREATE INDEX IF NOT EXISTS idx_submission_status_history_metadata_gin ON submission_status_history USING GIN(metadata);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_user_status ON dispute_submissions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_status_retry ON dispute_submissions(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_dispute_submissions_user_created ON dispute_submissions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_submission_status_history_submission_status ON submission_status_history(submission_id, status);

-- Add updated_at triggers
CREATE TRIGGER update_dispute_submissions_updated_at 
    BEFORE UPDATE ON dispute_submissions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to update submission status with history
CREATE OR REPLACE FUNCTION update_submission_status(
    p_submission_id UUID,
    p_status submission_status,
    p_status_reason TEXT DEFAULT NULL,
    p_amazon_response JSONB DEFAULT NULL,
    p_changed_by UUID DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    -- Update submission status
    UPDATE dispute_submissions 
    SET status = p_status, updated_at = NOW()
    WHERE id = p_submission_id;
    
    -- Add to status history
    INSERT INTO submission_status_history 
    (submission_id, status, status_reason, amazon_response, changed_by)
    VALUES (p_submission_id, p_status, p_status_reason, p_amazon_response, p_changed_by);
END;
$$ LANGUAGE plpgsql;

-- Create function to increment retry count
CREATE OR REPLACE FUNCTION increment_submission_retry(
    p_submission_id UUID,
    p_next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    UPDATE dispute_submissions 
    SET retry_count = retry_count + 1,
        last_retry_at = NOW(),
        next_retry_at = COALESCE(p_next_retry_at, NOW() + INTERVAL '1 hour'),
        updated_at = NOW()
    WHERE id = p_submission_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to get submissions ready for retry
CREATE OR REPLACE FUNCTION get_submissions_ready_for_retry()
RETURNS TABLE (
    submission_id UUID,
    user_id UUID,
    order_id VARCHAR(255),
    retry_count INTEGER,
    max_retries INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT ds.id, ds.user_id, ds.order_id, ds.retry_count, ds.max_retries
    FROM dispute_submissions ds
    WHERE ds.status IN ('failed', 'retrying')
    AND ds.retry_count < ds.max_retries
    AND (ds.next_retry_at IS NULL OR ds.next_retry_at <= NOW())
    ORDER BY ds.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE dispute_submissions IS 'Amazon SP-API dispute submissions tracking';
COMMENT ON TABLE submission_evidence_links IS 'Links between submissions and evidence documents';
COMMENT ON TABLE submission_status_history IS 'History of submission status changes';

COMMENT ON COLUMN dispute_submissions.submission_id IS 'Amazon SP-API submission ID';
COMMENT ON COLUMN dispute_submissions.amazon_case_id IS 'Amazon case ID for tracking';
COMMENT ON COLUMN dispute_submissions.confidence_score IS 'Confidence score of the evidence match';
COMMENT ON COLUMN dispute_submissions.submission_timestamp IS 'When the dispute was submitted to Amazon';
COMMENT ON COLUMN dispute_submissions.resolution_timestamp IS 'When Amazon resolved the dispute';
COMMENT ON COLUMN dispute_submissions.amount_approved IS 'Amount approved by Amazon';
COMMENT ON COLUMN dispute_submissions.resolution_notes IS 'Notes from Amazon about the resolution';
COMMENT ON COLUMN dispute_submissions.retry_count IS 'Number of retry attempts';
COMMENT ON COLUMN dispute_submissions.next_retry_at IS 'When to retry the submission next';

COMMENT ON COLUMN submission_evidence_links.evidence_type IS 'Type of evidence (supporting_document, invoice, etc.)';
COMMENT ON COLUMN submission_evidence_links.evidence_order IS 'Order of evidence in submission';

COMMENT ON COLUMN submission_status_history.status_reason IS 'Reason for status change';
COMMENT ON COLUMN submission_status_history.amazon_response IS 'Raw response from Amazon SP-API';
COMMENT ON COLUMN submission_status_history.changed_by IS 'User who made the status change';
