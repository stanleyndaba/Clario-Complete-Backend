-- Queue operations enhancements: attempts and DLQ

ALTER TABLE IF EXISTS evidence_ingestion_jobs
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS evidence_dlq (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID,
    source_id UUID,
    user_id UUID,
    error TEXT,
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_dlq_created_at ON evidence_dlq(created_at);

