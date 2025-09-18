-- PostgreSQL Migration: Convert SQLite schema to PostgreSQL
-- This migration creates the production-ready PostgreSQL schema

-- Enable UUID extension for better primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUM types for better data integrity
CREATE TYPE claim_status AS ENUM (
    'detected', 
    'validated', 
    'ready_to_file', 
    'submitted', 
    'rejected', 
    'approved', 
    'failed'
);

CREATE TYPE claim_type AS ENUM (
    'lost_inventory',
    'damaged_inventory', 
    'overcharge',
    'missing_reimbursement',
    'incorrect_fees',
    'other'
);

CREATE TYPE filing_status AS ENUM (
    'pending',
    'submitted',
    'under_review',
    'approved',
    'rejected',
    'cancelled'
);

-- Claims table with proper PostgreSQL types
CREATE TABLE IF NOT EXISTS claims (
    claim_id VARCHAR(255) PRIMARY KEY,
    status claim_status NOT NULL DEFAULT 'detected',
    claim_type claim_type NOT NULL,
    confidence DECIMAL(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    amount_estimate DECIMAL(10,2) NOT NULL CHECK (amount_estimate >= 0),
    quantity_affected INTEGER NOT NULL CHECK (quantity_affected >= 0),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Validations table
CREATE TABLE IF NOT EXISTS validations (
    id SERIAL PRIMARY KEY,
    claim_id VARCHAR(255) NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
    compliant BOOLEAN NOT NULL DEFAULT FALSE,
    ml_validity_score DECIMAL(5,4) NOT NULL CHECK (ml_validity_score >= 0 AND ml_validity_score <= 1),
    missing_evidence JSONB NOT NULL DEFAULT '[]',
    reasons JSONB NOT NULL DEFAULT '[]',
    auto_file_ready BOOLEAN NOT NULL DEFAULT FALSE,
    confidence_calibrated DECIMAL(5,4) NOT NULL CHECK (confidence_calibrated >= 0 AND confidence_calibrated <= 1),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Filings table
CREATE TABLE IF NOT EXISTS filings (
    id SERIAL PRIMARY KEY,
    claim_id VARCHAR(255) NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
    amazon_case_id VARCHAR(255),
    status filing_status NOT NULL DEFAULT 'pending',
    message TEXT,
    packet JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Idempotency keys table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    claim_id VARCHAR(255) REFERENCES claims(claim_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Users table with enhanced structure
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    name VARCHAR(255),
    amazon_seller_id VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255),
    linked_marketplaces JSONB DEFAULT '[]',
    stripe_customer_id VARCHAR(255),
    stripe_account_id VARCHAR(255),
    last_sync_attempt_at TIMESTAMP WITH TIME ZONE,
    last_sync_completed_at TIMESTAMP WITH TIME ZONE,
    last_sync_job_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- OAuth tokens table
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_type ON claims(claim_type);
CREATE INDEX IF NOT EXISTS idx_claims_created_at ON claims(created_at);
CREATE INDEX IF NOT EXISTS idx_validations_claim_id ON validations(claim_id);
CREATE INDEX IF NOT EXISTS idx_filings_claim_id ON filings(claim_id);
CREATE INDEX IF NOT EXISTS idx_filings_status ON filings(status);
CREATE INDEX IF NOT EXISTS idx_users_amazon_seller_id ON users(amazon_seller_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider ON oauth_tokens(provider);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_claims_updated_at 
    BEFORE UPDATE ON claims 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_oauth_tokens_updated_at 
    BEFORE UPDATE ON oauth_tokens 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE claims IS 'FBA reimbursement claims detected by the system';
COMMENT ON TABLE validations IS 'ML validation results for claims';
COMMENT ON TABLE filings IS 'Amazon case filings and their status';
COMMENT ON TABLE users IS 'User profiles and authentication data';
COMMENT ON TABLE oauth_tokens IS 'Encrypted OAuth refresh tokens';
COMMENT ON TABLE idempotency_keys IS 'Idempotency keys to prevent duplicate processing';

