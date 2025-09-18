-- Evidence Validator (EV) Database Schema
-- Phase 1: Secure Ingestion Connectors

-- Create ENUM types for evidence sources
CREATE TYPE evidence_provider AS ENUM (
    'gmail',
    'outlook', 
    'gdrive',
    'dropbox'
);

CREATE TYPE evidence_source_status AS ENUM (
    'connected',
    'disconnected',
    'error',
    'refreshing'
);

CREATE TYPE document_processing_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'skipped'
);

-- Evidence sources table
CREATE TABLE IF NOT EXISTS evidence_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider evidence_provider NOT NULL,
    account_email VARCHAR(255) NOT NULL,
    status evidence_source_status NOT NULL DEFAULT 'connected',
    encrypted_access_token TEXT NOT NULL,
    encrypted_refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    permissions JSONB NOT NULL DEFAULT '[]',
    metadata JSONB NOT NULL DEFAULT '{}',
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider, account_email)
);

-- Evidence documents table
CREATE TABLE IF NOT EXISTS evidence_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES evidence_sources(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider evidence_provider NOT NULL,
    external_id VARCHAR(500) NOT NULL,
    filename VARCHAR(500) NOT NULL,
    size_bytes BIGINT NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    modified_at TIMESTAMP WITH TIME ZONE NOT NULL,
    sender VARCHAR(255),
    subject TEXT,
    message_id VARCHAR(500),
    folder_path TEXT,
    download_url TEXT,
    thumbnail_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    processing_status document_processing_status NOT NULL DEFAULT 'pending',
    ocr_text TEXT,
    extracted_data JSONB,
    ingested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(source_id, external_id)
);

-- Evidence ingestion jobs table
CREATE TABLE IF NOT EXISTS evidence_ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES evidence_sources(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    documents_found INTEGER NOT NULL DEFAULT 0,
    documents_processed INTEGER NOT NULL DEFAULT 0,
    errors JSONB NOT NULL DEFAULT '[]',
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    metadata JSONB NOT NULL DEFAULT '{}'
);

-- Evidence matches table (for Phase 2+)
CREATE TABLE IF NOT EXISTS evidence_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id VARCHAR(255) NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    confidence_score DECIMAL(5,4) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    match_type VARCHAR(100) NOT NULL,
    matched_fields JSONB NOT NULL DEFAULT '[]',
    reasoning TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(claim_id, document_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_evidence_sources_user_id ON evidence_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_evidence_sources_provider ON evidence_sources(provider);
CREATE INDEX IF NOT EXISTS idx_evidence_sources_status ON evidence_sources(status);
CREATE INDEX IF NOT EXISTS idx_evidence_sources_account_email ON evidence_sources(account_email);

CREATE INDEX IF NOT EXISTS idx_evidence_documents_source_id ON evidence_documents(source_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_user_id ON evidence_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_provider ON evidence_documents(provider);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_processing_status ON evidence_documents(processing_status);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_created_at ON evidence_documents(created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_ingested_at ON evidence_documents(ingested_at);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_external_id ON evidence_documents(external_id);

CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_jobs_source_id ON evidence_ingestion_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_jobs_user_id ON evidence_ingestion_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_jobs_status ON evidence_ingestion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_jobs_started_at ON evidence_ingestion_jobs(started_at);

CREATE INDEX IF NOT EXISTS idx_evidence_matches_claim_id ON evidence_matches(claim_id);
CREATE INDEX IF NOT EXISTS idx_evidence_matches_document_id ON evidence_matches(document_id);
CREATE INDEX IF NOT EXISTS idx_evidence_matches_user_id ON evidence_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_evidence_matches_confidence_score ON evidence_matches(confidence_score);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_evidence_sources_permissions_gin ON evidence_sources USING GIN(permissions);
CREATE INDEX IF NOT EXISTS idx_evidence_sources_metadata_gin ON evidence_sources USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_metadata_gin ON evidence_documents USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_extracted_data_gin ON evidence_documents USING GIN(extracted_data);
CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_jobs_errors_gin ON evidence_ingestion_jobs USING GIN(errors);
CREATE INDEX IF NOT EXISTS idx_evidence_ingestion_jobs_metadata_gin ON evidence_ingestion_jobs USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_evidence_matches_matched_fields_gin ON evidence_matches USING GIN(matched_fields);

-- Add updated_at triggers
CREATE TRIGGER update_evidence_sources_updated_at 
    BEFORE UPDATE ON evidence_sources 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE evidence_sources IS 'OAuth connections to external evidence sources (Gmail, Outlook, Drive, Dropbox)';
COMMENT ON TABLE evidence_documents IS 'Documents ingested from external evidence sources';
COMMENT ON TABLE evidence_ingestion_jobs IS 'Background jobs for ingesting documents from evidence sources';
COMMENT ON TABLE evidence_matches IS 'Matches between evidence documents and claim candidates';

COMMENT ON COLUMN evidence_sources.encrypted_access_token IS 'Encrypted OAuth access token';
COMMENT ON COLUMN evidence_sources.encrypted_refresh_token IS 'Encrypted OAuth refresh token for token renewal';
COMMENT ON COLUMN evidence_sources.permissions IS 'OAuth scopes granted by the user';
COMMENT ON COLUMN evidence_sources.metadata IS 'Provider-specific metadata (account info, quotas, etc.)';

COMMENT ON COLUMN evidence_documents.external_id IS 'Provider-specific document ID (Gmail message ID, Drive file ID, etc.)';
COMMENT ON COLUMN evidence_documents.download_url IS 'Temporary URL to download document content';
COMMENT ON COLUMN evidence_documents.thumbnail_url IS 'URL to document thumbnail/preview';
COMMENT ON COLUMN evidence_documents.extracted_data IS 'Structured data extracted from document (amount, date, vendor, etc.)';

COMMENT ON COLUMN evidence_ingestion_jobs.progress IS 'Job progress percentage (0-100)';
COMMENT ON COLUMN evidence_ingestion_jobs.errors IS 'Array of error messages encountered during processing';

COMMENT ON COLUMN evidence_matches.confidence_score IS 'ML confidence score for the match (0.0-1.0)';
COMMENT ON COLUMN evidence_matches.match_type IS 'Type of match (amount, date, vendor, sku, etc.)';
COMMENT ON COLUMN evidence_matches.matched_fields IS 'List of fields that matched between document and claim';
COMMENT ON COLUMN evidence_matches.reasoning IS 'Human-readable explanation of why this match was made';
