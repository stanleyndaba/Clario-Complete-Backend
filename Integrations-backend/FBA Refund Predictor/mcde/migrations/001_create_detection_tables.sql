-- Create detection pipeline tables for MCDE module

-- Create enums
CREATE TYPE anomaly_type AS ENUM (
    'lost_units',
    'overcharged_fees', 
    'damaged_stock',
    'duplicate_charges',
    'invalid_shipping',
    'pricing_discrepancy'
);

CREATE TYPE anomaly_severity AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);

CREATE TYPE threshold_operator AS ENUM (
    'greater_than',
    'greater_than_or_equal',
    'less_than',
    'less_than_or_equal',
    'equals',
    'not_equals'
);

CREATE TYPE detection_job_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'retrying'
);

CREATE TYPE detection_priority AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);

-- Create detection_jobs table
CREATE TABLE detection_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL,
    user_id UUID NOT NULL,
    status detection_job_status NOT NULL DEFAULT 'pending',
    priority detection_priority NOT NULL DEFAULT 'medium',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    failure_reason TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create detection_results table
CREATE TABLE detection_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    detection_job_id UUID NOT NULL,
    cost_doc_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    anomaly_type anomaly_type NOT NULL,
    severity anomaly_severity NOT NULL,
    confidence DECIMAL(5,4) NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    evidence_url TEXT NOT NULL,
    evidence_json JSONB NOT NULL,
    threshold_value DECIMAL(15,2) NOT NULL,
    actual_value DECIMAL(15,2) NOT NULL,
    is_whitelisted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create detection_thresholds table
CREATE TABLE detection_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anomaly_type anomaly_type NOT NULL,
    threshold DECIMAL(15,2) NOT NULL,
    operator threshold_operator NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create detection_whitelists table
CREATE TABLE detection_whitelists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku_code TEXT,
    vendor_name TEXT,
    account_id TEXT,
    reason TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_detection_jobs_claim_id ON detection_jobs(claim_id);
CREATE INDEX idx_detection_jobs_user_id ON detection_jobs(user_id);
CREATE INDEX idx_detection_jobs_status ON detection_jobs(status);
CREATE INDEX idx_detection_jobs_priority ON detection_jobs(priority);
CREATE INDEX idx_detection_jobs_created_at ON detection_jobs(created_at);

CREATE INDEX idx_detection_results_job_id ON detection_results(detection_job_id);
CREATE INDEX idx_detection_results_cost_doc_id ON detection_results(cost_doc_id);
CREATE INDEX idx_detection_results_sku_id ON detection_results(sku_id);
CREATE INDEX idx_detection_results_anomaly_type ON detection_results(anomaly_type);
CREATE INDEX idx_detection_results_severity ON detection_results(severity);
CREATE INDEX idx_detection_results_created_at ON detection_results(created_at);

CREATE INDEX idx_detection_thresholds_type ON detection_thresholds(anomaly_type);
CREATE INDEX idx_detection_thresholds_active ON detection_thresholds(is_active);

CREATE INDEX idx_detection_whitelists_sku ON detection_whitelists(sku_code);
CREATE INDEX idx_detection_whitelists_vendor ON detection_whitelists(vendor_name);
CREATE INDEX idx_detection_whitelists_account ON detection_whitelists(account_id);
CREATE INDEX idx_detection_whitelists_active ON detection_whitelists(is_active);

-- Insert default thresholds
INSERT INTO detection_thresholds (anomaly_type, threshold, operator, description) VALUES
('lost_units', 1.0, 'greater_than', 'Alert when lost units exceed 1'),
('overcharged_fees', 0.50, 'greater_than', 'Alert when fee discrepancy exceeds $0.50'),
('damaged_stock', 0.0, 'greater_than', 'Alert when damaged stock is greater than 0');

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_detection_jobs_updated_at 
    BEFORE UPDATE ON detection_jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_detection_thresholds_updated_at 
    BEFORE UPDATE ON detection_thresholds 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_detection_whitelists_updated_at 
    BEFORE UPDATE ON detection_whitelists 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


