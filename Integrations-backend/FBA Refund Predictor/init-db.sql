-- FBA Refund Predictor Database Initialization
-- This script creates all necessary tables and initial data

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS cost_docs;
CREATE SCHEMA IF NOT EXISTS refunds;
CREATE SCHEMA IF NOT EXISTS ml_predictions;
CREATE SCHEMA IF NOT EXISTS audit;

-- Cost Documentation Tables
CREATE TABLE IF NOT EXISTS cost_docs.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    claim_id VARCHAR(100),
    sku_id VARCHAR(100),
    metadata JSONB,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(100),
    updated_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS cost_docs.document_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES cost_docs.documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    changes_description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS cost_docs.cost_extractions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES cost_docs.documents(id) ON DELETE CASCADE,
    extracted_amount DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'USD',
    confidence_score DECIMAL(3,2),
    extraction_method VARCHAR(50),
    raw_text TEXT,
    processed_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Refund Engine Tables
CREATE TABLE IF NOT EXISTS refunds.claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_number VARCHAR(100) UNIQUE NOT NULL,
    customer_id VARCHAR(100) NOT NULL,
    claim_amount DECIMAL(10,2) NOT NULL,
    claim_description TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    priority VARCHAR(20) DEFAULT 'medium',
    assigned_agent VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT
);

CREATE TABLE IF NOT EXISTS refunds.discrepancies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID REFERENCES refunds.claims(id) ON DELETE CASCADE,
    discrepancy_type VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    evidence_document_ids UUID[],
    status VARCHAR(50) DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS refunds.ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID REFERENCES refunds.claims(id) ON DELETE CASCADE,
    entry_type VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL,
    description TEXT,
    reference_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(100)
);

-- ML Predictions Tables
CREATE TABLE IF NOT EXISTS ml_predictions.predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID REFERENCES refunds.claims(id) ON DELETE CASCADE,
    model_version VARCHAR(50) NOT NULL,
    success_probability DECIMAL(3,2) NOT NULL,
    confidence_score DECIMAL(3,2) NOT NULL,
    prediction_class VARCHAR(50) NOT NULL,
    uncertainty_score DECIMAL(3,2),
    features JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ml_predictions.model_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_version VARCHAR(50) NOT NULL,
    metric_name VARCHAR(50) NOT NULL,
    metric_value DECIMAL(5,4) NOT NULL,
    evaluation_date DATE NOT NULL,
    dataset_size INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ml_predictions.feature_importance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_version VARCHAR(50) NOT NULL,
    feature_name VARCHAR(100) NOT NULL,
    importance_score DECIMAL(5,4) NOT NULL,
    evaluation_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit Tables
CREATE TABLE IF NOT EXISTS audit.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    changed_by VARCHAR(100),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

CREATE TABLE IF NOT EXISTS audit.api_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER NOT NULL,
    response_time_ms INTEGER,
    user_id VARCHAR(100),
    ip_address INET,
    user_agent TEXT,
    request_body JSONB,
    response_body JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_claim_id ON cost_docs.documents(claim_id);
CREATE INDEX IF NOT EXISTS idx_documents_sku_id ON cost_docs.documents(sku_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON cost_docs.documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON cost_docs.documents(created_at);

CREATE INDEX IF NOT EXISTS idx_claims_customer_id ON refunds.claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON refunds.claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_created_at ON refunds.claims(created_at);

CREATE INDEX IF NOT EXISTS idx_predictions_claim_id ON ml_predictions.predictions(claim_id);
CREATE INDEX IF NOT EXISTS idx_predictions_model_version ON ml_predictions.predictions(model_version);
CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON ml_predictions.predictions(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON audit.audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_at ON audit.audit_logs(changed_at);

-- Create full-text search indexes
CREATE INDEX IF NOT EXISTS idx_documents_metadata_gin ON cost_docs.documents USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_claims_description_trgm ON refunds.claims USING GIN (claim_description gin_trgm_ops);

-- Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON cost_docs.documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_claims_updated_at BEFORE UPDATE ON refunds.claims
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create audit triggers
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit.audit_logs (table_name, record_id, action, new_values, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), current_user);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit.audit_logs (table_name, record_id, action, old_values, new_values, changed_by)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), current_user);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO audit.audit_logs (table_name, record_id, action, old_values, changed_by)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), current_user);
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

-- Apply audit triggers to main tables
CREATE TRIGGER audit_documents_trigger AFTER INSERT OR UPDATE OR DELETE ON cost_docs.documents
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_claims_trigger AFTER INSERT OR UPDATE OR DELETE ON refunds.claims
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Insert initial data
INSERT INTO ml_predictions.model_performance (model_version, metric_name, metric_value, evaluation_date, dataset_size) VALUES
('v1.0.0', 'accuracy', 0.87, CURRENT_DATE, 10000),
('v1.0.0', 'precision', 0.82, CURRENT_DATE, 10000),
('v1.0.0', 'recall', 0.91, CURRENT_DATE, 10000),
('v1.0.0', 'auc', 0.92, CURRENT_DATE, 10000)
ON CONFLICT DO NOTHING;

INSERT INTO ml_predictions.feature_importance (model_version, feature_name, importance_score, evaluation_date) VALUES
('v1.0.0', 'claim_amount', 0.25, CURRENT_DATE),
('v1.0.0', 'customer_history_score', 0.30, CURRENT_DATE),
('v1.0.0', 'product_category', 0.20, CURRENT_DATE),
('v1.0.0', 'days_since_purchase', 0.15, CURRENT_DATE),
('v1.0.0', 'claim_description', 0.10, CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- Create views for common queries
CREATE OR REPLACE VIEW cost_docs.document_summary AS
SELECT 
    d.id,
    d.filename,
    d.claim_id,
    d.sku_id,
    d.status,
    d.created_at,
    ce.extracted_amount,
    ce.confidence_score
FROM cost_docs.documents d
LEFT JOIN cost_docs.cost_extractions ce ON d.id = ce.document_id;

CREATE OR REPLACE VIEW refunds.claim_summary AS
SELECT 
    c.id,
    c.claim_number,
    c.customer_id,
    c.claim_amount,
    c.status,
    c.created_at,
    p.success_probability,
    p.prediction_class
FROM refunds.claims c
LEFT JOIN ml_predictions.predictions p ON c.id = p.claim_id;

-- Grant permissions
GRANT USAGE ON SCHEMA cost_docs TO postgres;
GRANT USAGE ON SCHEMA refunds TO postgres;
GRANT USAGE ON SCHEMA ml_predictions TO postgres;
GRANT USAGE ON SCHEMA audit TO postgres;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cost_docs TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA refunds TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ml_predictions TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA audit TO postgres;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA cost_docs TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA refunds TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ml_predictions TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA audit TO postgres;

