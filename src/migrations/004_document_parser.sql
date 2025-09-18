-- Document Parser Pipeline Database Schema
-- Phase 2: Structured invoice data extraction

-- Create ENUM types for parser functionality
CREATE TYPE parser_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'retrying'
);

CREATE TYPE parser_type AS ENUM (
    'pdf',
    'email',
    'image'
);

CREATE TYPE extraction_method AS ENUM (
    'regex',
    'ocr',
    'ml'
);

-- Add parser columns to evidence_documents table
ALTER TABLE evidence_documents 
ADD COLUMN IF NOT EXISTS parsed_metadata JSONB,
ADD COLUMN IF NOT EXISTS parser_status parser_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS parser_confidence DECIMAL(5,4),
ADD COLUMN IF NOT EXISTS parser_error TEXT,
ADD COLUMN IF NOT EXISTS parser_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS parser_completed_at TIMESTAMP WITH TIME ZONE;

-- Create parser jobs table
CREATE TABLE IF NOT EXISTS parser_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status parser_status NOT NULL DEFAULT 'pending',
    parser_type parser_type NOT NULL,
    extraction_method extraction_method NOT NULL DEFAULT 'regex',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    error_message TEXT,
    confidence_score DECIMAL(5,4),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create parser job results table
CREATE TABLE IF NOT EXISTS parser_job_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES parser_jobs(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
    supplier_name VARCHAR(255),
    invoice_number VARCHAR(255),
    invoice_date DATE,
    total_amount DECIMAL(10,2),
    currency VARCHAR(10),
    tax_amount DECIMAL(10,2),
    shipping_amount DECIMAL(10,2),
    payment_terms TEXT,
    po_number VARCHAR(255),
    raw_text TEXT,
    line_items JSONB NOT NULL DEFAULT '[]',
    extraction_method extraction_method NOT NULL,
    confidence_score DECIMAL(5,4) NOT NULL,
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_evidence_documents_parser_status ON evidence_documents(parser_status);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_parser_confidence ON evidence_documents(parser_confidence);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_parser_started_at ON evidence_documents(parser_started_at);
CREATE INDEX IF NOT EXISTS idx_evidence_documents_parser_completed_at ON evidence_documents(parser_completed_at);

CREATE INDEX IF NOT EXISTS idx_parser_jobs_document_id ON parser_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_user_id ON parser_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_status ON parser_jobs(status);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_parser_type ON parser_jobs(parser_type);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_started_at ON parser_jobs(started_at);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_retry_count ON parser_jobs(retry_count);

CREATE INDEX IF NOT EXISTS idx_parser_job_results_job_id ON parser_job_results(job_id);
CREATE INDEX IF NOT EXISTS idx_parser_job_results_document_id ON parser_job_results(document_id);
CREATE INDEX IF NOT EXISTS idx_parser_job_results_supplier_name ON parser_job_results(supplier_name);
CREATE INDEX IF NOT EXISTS idx_parser_job_results_invoice_date ON parser_job_results(invoice_date);
CREATE INDEX IF NOT EXISTS idx_parser_job_results_total_amount ON parser_job_results(total_amount);
CREATE INDEX IF NOT EXISTS idx_parser_job_results_confidence_score ON parser_job_results(confidence_score);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_evidence_documents_parsed_metadata_gin ON evidence_documents USING GIN(parsed_metadata);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_metadata_gin ON parser_jobs USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_parser_job_results_line_items_gin ON parser_job_results USING GIN(line_items);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_evidence_documents_parser_status_confidence ON evidence_documents(parser_status, parser_confidence);
CREATE INDEX IF NOT EXISTS idx_parser_jobs_status_retry_count ON parser_jobs(status, retry_count);
CREATE INDEX IF NOT EXISTS idx_parser_job_results_supplier_date ON parser_job_results(supplier_name, invoice_date);

-- Add updated_at triggers
CREATE TRIGGER update_parser_jobs_updated_at 
    BEFORE UPDATE ON parser_jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE parser_jobs IS 'Background jobs for parsing documents and extracting structured data';
COMMENT ON TABLE parser_job_results IS 'Results of document parsing jobs with extracted invoice data';

COMMENT ON COLUMN evidence_documents.parsed_metadata IS 'Structured invoice data extracted from the document';
COMMENT ON COLUMN evidence_documents.parser_status IS 'Current status of the document parsing process';
COMMENT ON COLUMN evidence_documents.parser_confidence IS 'Confidence score of the parsing result (0.0-1.0)';
COMMENT ON COLUMN evidence_documents.parser_error IS 'Error message if parsing failed';

COMMENT ON COLUMN parser_jobs.parser_type IS 'Type of document being parsed (pdf, email, image)';
COMMENT ON COLUMN parser_jobs.extraction_method IS 'Method used for extraction (regex, ocr, ml)';
COMMENT ON COLUMN parser_jobs.retry_count IS 'Number of times the job has been retried';
COMMENT ON COLUMN parser_jobs.max_retries IS 'Maximum number of retries allowed';

COMMENT ON COLUMN parser_job_results.supplier_name IS 'Name of the supplier/vendor from the invoice';
COMMENT ON COLUMN parser_job_results.invoice_number IS 'Invoice number or reference';
COMMENT ON COLUMN parser_job_results.invoice_date IS 'Date of the invoice';
COMMENT ON COLUMN parser_job_results.total_amount IS 'Total amount of the invoice';
COMMENT ON COLUMN parser_job_results.currency IS 'Currency code (USD, EUR, etc.)';
COMMENT ON COLUMN parser_job_results.line_items IS 'Array of line items with SKU, description, quantity, unit price, total';
COMMENT ON COLUMN parser_job_results.raw_text IS 'Raw text extracted from the document';
COMMENT ON COLUMN parser_job_results.confidence_score IS 'Confidence score of the extraction (0.0-1.0)';
COMMENT ON COLUMN parser_job_results.processing_time_ms IS 'Time taken to process the document in milliseconds';
