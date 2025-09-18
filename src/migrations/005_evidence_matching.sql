-- Evidence Matching Engine Database Schema
-- Phase 3: Hybrid matching engine for Evidence Validator

-- Create ENUM types for matching functionality
CREATE TYPE dispute_status AS ENUM (
    'pending',
    'evidence_linked',
    'auto_submitted',
    'smart_prompt_sent',
    'manual_review',
    'resolved',
    'rejected'
);

CREATE TYPE link_type AS ENUM (
    'auto_match',
    'manual_link',
    'smart_prompt_confirmed',
    'ml_suggested'
);

CREATE TYPE prompt_status AS ENUM (
    'pending',
    'answered',
    'dismissed',
    'expired'
);

-- Dispute cases table
CREATE TABLE IF NOT EXISTS dispute_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id VARCHAR(255) NOT NULL,
    asin VARCHAR(50),
    sku VARCHAR(100),
    dispute_type VARCHAR(100) NOT NULL,
    status dispute_status NOT NULL DEFAULT 'pending',
    amount_claimed DECIMAL(10,2),
    currency VARCHAR(10) DEFAULT 'USD',
    dispute_date DATE NOT NULL,
    order_date DATE,
    evidence_linked_ids JSONB DEFAULT '[]',
    match_confidence DECIMAL(5,4),
    match_path VARCHAR(100),
    auto_submit_ready BOOLEAN DEFAULT FALSE,
    smart_prompt_sent BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Evidence document links table
CREATE TABLE IF NOT EXISTS dispute_evidence_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
    evidence_document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
    link_type link_type NOT NULL,
    confidence DECIMAL(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    match_reasoning TEXT,
    matched_fields JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(dispute_id, evidence_document_id)
);

-- Smart prompts table
CREATE TABLE IF NOT EXISTS smart_prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
    evidence_document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]',
    status prompt_status NOT NULL DEFAULT 'pending',
    selected_option VARCHAR(255),
    answered_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Evidence matching jobs table
CREATE TABLE IF NOT EXISTS evidence_matching_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    disputes_processed INTEGER DEFAULT 0,
    evidence_documents_processed INTEGER DEFAULT 0,
    matches_found INTEGER DEFAULT 0,
    auto_submits_triggered INTEGER DEFAULT 0,
    smart_prompts_created INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}'
);

-- Evidence matching results table
CREATE TABLE IF NOT EXISTS evidence_matching_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES evidence_matching_jobs(id) ON DELETE CASCADE,
    dispute_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
    evidence_document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
    rule_score DECIMAL(5,4),
    ml_score DECIMAL(5,4),
    final_confidence DECIMAL(5,4) NOT NULL,
    match_type VARCHAR(100),
    matched_fields JSONB DEFAULT '[]',
    reasoning TEXT,
    action_taken VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_dispute_cases_user_id ON dispute_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_order_id ON dispute_cases(order_id);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_asin ON dispute_cases(asin);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_sku ON dispute_cases(sku);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_status ON dispute_cases(status);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_dispute_date ON dispute_cases(dispute_date);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_match_confidence ON dispute_cases(match_confidence);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_dispute_id ON dispute_evidence_links(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_evidence_document_id ON dispute_evidence_links(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_link_type ON dispute_evidence_links(link_type);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_confidence ON dispute_evidence_links(confidence);

CREATE INDEX IF NOT EXISTS idx_smart_prompts_dispute_id ON smart_prompts(dispute_id);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_evidence_document_id ON smart_prompts(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_status ON smart_prompts(status);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_expires_at ON smart_prompts(expires_at);

CREATE INDEX IF NOT EXISTS idx_evidence_matching_jobs_user_id ON evidence_matching_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_jobs_status ON evidence_matching_jobs(status);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_jobs_started_at ON evidence_matching_jobs(started_at);

CREATE INDEX IF NOT EXISTS idx_evidence_matching_results_job_id ON evidence_matching_results(job_id);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_results_dispute_id ON evidence_matching_results(dispute_id);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_results_evidence_document_id ON evidence_matching_results(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_results_final_confidence ON evidence_matching_results(final_confidence);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_dispute_cases_evidence_linked_ids_gin ON dispute_cases USING GIN(evidence_linked_ids);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_metadata_gin ON dispute_cases USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_matched_fields_gin ON dispute_evidence_links USING GIN(matched_fields);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_options_gin ON smart_prompts USING GIN(options);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_jobs_errors_gin ON evidence_matching_jobs USING GIN(errors);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_jobs_metadata_gin ON evidence_matching_jobs USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_results_matched_fields_gin ON evidence_matching_results USING GIN(matched_fields);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_dispute_cases_user_status ON dispute_cases(user_id, status);
CREATE INDEX IF NOT EXISTS idx_dispute_cases_user_dispute_date ON dispute_cases(user_id, dispute_date);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_status_expires ON smart_prompts(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_evidence_matching_results_confidence_action ON evidence_matching_results(final_confidence, action_taken);

-- Add updated_at triggers
CREATE TRIGGER update_dispute_cases_updated_at 
    BEFORE UPDATE ON dispute_cases 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_smart_prompts_updated_at 
    BEFORE UPDATE ON smart_prompts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE dispute_cases IS 'Dispute cases that need evidence matching';
COMMENT ON TABLE dispute_evidence_links IS 'Links between dispute cases and evidence documents';
COMMENT ON TABLE smart_prompts IS 'Smart prompts sent to users for ambiguous evidence matches';
COMMENT ON TABLE evidence_matching_jobs IS 'Background jobs for evidence matching';
COMMENT ON TABLE evidence_matching_results IS 'Results of evidence matching operations';

COMMENT ON COLUMN dispute_cases.order_id IS 'Amazon order ID or external order identifier';
COMMENT ON COLUMN dispute_cases.asin IS 'Amazon ASIN for the disputed product';
COMMENT ON COLUMN dispute_cases.sku IS 'Seller SKU for the disputed product';
COMMENT ON COLUMN dispute_cases.dispute_type IS 'Type of dispute (lost_inventory, damaged_inventory, etc.)';
COMMENT ON COLUMN dispute_cases.evidence_linked_ids IS 'Array of evidence document IDs linked to this dispute';
COMMENT ON COLUMN dispute_cases.match_confidence IS 'Highest confidence score of any evidence match';
COMMENT ON COLUMN dispute_cases.match_path IS 'Path taken for matching (rule_based, ml_based, hybrid)';
COMMENT ON COLUMN dispute_cases.auto_submit_ready IS 'Whether this dispute is ready for auto-submission';
COMMENT ON COLUMN dispute_cases.smart_prompt_sent IS 'Whether a smart prompt has been sent for this dispute';

COMMENT ON COLUMN dispute_evidence_links.link_type IS 'How the evidence was linked (auto_match, manual_link, etc.)';
COMMENT ON COLUMN dispute_evidence_links.confidence IS 'Confidence score for this specific link (0.0-1.0)';
COMMENT ON COLUMN dispute_evidence_links.match_reasoning IS 'Human-readable explanation of why this match was made';
COMMENT ON COLUMN dispute_evidence_links.matched_fields IS 'Array of fields that matched between dispute and evidence';

COMMENT ON COLUMN smart_prompts.question IS 'Question to ask the user about the evidence match';
COMMENT ON COLUMN smart_prompts.options IS 'Array of possible answers for the question';
COMMENT ON COLUMN smart_prompts.selected_option IS 'Option selected by the user';
COMMENT ON COLUMN smart_prompts.expires_at IS 'When the prompt expires and becomes invalid';

COMMENT ON COLUMN evidence_matching_jobs.disputes_processed IS 'Number of dispute cases processed in this job';
COMMENT ON COLUMN evidence_matching_jobs.evidence_documents_processed IS 'Number of evidence documents processed in this job';
COMMENT ON COLUMN evidence_matching_jobs.matches_found IS 'Number of matches found in this job';
COMMENT ON COLUMN evidence_matching_jobs.auto_submits_triggered IS 'Number of auto-submits triggered in this job';
COMMENT ON COLUMN evidence_matching_jobs.smart_prompts_created IS 'Number of smart prompts created in this job';

COMMENT ON COLUMN evidence_matching_results.rule_score IS 'Score from rule-based matching (0.0-1.0)';
COMMENT ON COLUMN evidence_matching_results.ml_score IS 'Score from ML-based matching (0.0-1.0)';
COMMENT ON COLUMN evidence_matching_results.final_confidence IS 'Final combined confidence score (0.0-1.0)';
COMMENT ON COLUMN evidence_matching_results.match_type IS 'Type of match (exact_invoice, sku_match, supplier_match, etc.)';
COMMENT ON COLUMN evidence_matching_results.action_taken IS 'Action taken based on confidence (auto_submit, smart_prompt, no_action)';

