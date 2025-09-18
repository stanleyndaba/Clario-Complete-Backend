-- Evidence Prompts & Proof Packets Database Schema
-- Phase 4: Smart Prompts & Proof Packets for Evidence Validator

-- Create ENUM types for prompt and packet functionality
CREATE TYPE prompt_status AS ENUM (
    'pending',
    'answered',
    'expired',
    'cancelled'
);

CREATE TYPE packet_status AS ENUM (
    'pending',
    'generating',
    'completed',
    'failed'
);

CREATE TYPE audit_action AS ENUM (
    'prompt_created',
    'prompt_answered',
    'prompt_expired',
    'prompt_cancelled',
    'packet_generated',
    'packet_failed',
    'packet_downloaded'
);

-- Evidence prompts table
CREATE TABLE IF NOT EXISTS evidence_prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    status prompt_status NOT NULL DEFAULT 'pending',
    answer TEXT,
    answer_reasoning TEXT,
    answered_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Proof packets table
CREATE TABLE IF NOT EXISTS proof_packets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    packet_url TEXT NOT NULL,
    packet_size_bytes BIGINT,
    status packet_status NOT NULL DEFAULT 'pending',
    generation_started_at TIMESTAMP WITH TIME ZONE,
    generation_completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Enhanced audit log table for comprehensive tracking
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_id UUID REFERENCES dispute_cases(id) ON DELETE SET NULL,
    action audit_action NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_claim_id ON evidence_prompts(claim_id);
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_user_id ON evidence_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_status ON evidence_prompts(status);
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_expires_at ON evidence_prompts(expires_at);
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_created_at ON evidence_prompts(created_at);

CREATE INDEX IF NOT EXISTS idx_proof_packets_claim_id ON proof_packets(claim_id);
CREATE INDEX IF NOT EXISTS idx_proof_packets_user_id ON proof_packets(user_id);
CREATE INDEX IF NOT EXISTS idx_proof_packets_status ON proof_packets(status);
CREATE INDEX IF NOT EXISTS idx_proof_packets_created_at ON proof_packets(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_claim_id ON audit_log(claim_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON audit_log(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_options_gin ON evidence_prompts USING GIN(options);
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_metadata_gin ON evidence_prompts USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_proof_packets_metadata_gin ON proof_packets USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_audit_log_details_gin ON audit_log USING GIN(details);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_claim_status ON evidence_prompts(claim_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_user_status ON evidence_prompts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_prompts_status_expires ON evidence_prompts(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_proof_packets_claim_status ON proof_packets(claim_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_action ON audit_log(user_id, action);
CREATE INDEX IF NOT EXISTS idx_audit_log_claim_action ON audit_log(claim_id, action);

-- Add updated_at triggers
CREATE TRIGGER update_evidence_prompts_updated_at 
    BEFORE UPDATE ON evidence_prompts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_proof_packets_updated_at 
    BEFORE UPDATE ON proof_packets 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE evidence_prompts IS 'Smart prompts sent to sellers for evidence clarification';
COMMENT ON TABLE proof_packets IS 'Generated proof packets containing all evidence for claims';
COMMENT ON TABLE audit_log IS 'Comprehensive audit log for all evidence validator operations';

COMMENT ON COLUMN evidence_prompts.question IS 'Question to ask the seller about the evidence';
COMMENT ON COLUMN evidence_prompts.options IS 'Array of possible answers for the question';
COMMENT ON COLUMN evidence_prompts.answer IS 'Answer provided by the seller';
COMMENT ON COLUMN evidence_prompts.answer_reasoning IS 'Additional reasoning provided by the seller';
COMMENT ON COLUMN evidence_prompts.expires_at IS 'When the prompt expires and becomes invalid';
COMMENT ON COLUMN evidence_prompts.metadata IS 'Additional metadata for the prompt';

COMMENT ON COLUMN proof_packets.packet_url IS 'S3 URL where the proof packet is stored';
COMMENT ON COLUMN proof_packets.packet_size_bytes IS 'Size of the generated proof packet in bytes';
COMMENT ON COLUMN proof_packets.generation_started_at IS 'When packet generation started';
COMMENT ON COLUMN proof_packets.generation_completed_at IS 'When packet generation completed';
COMMENT ON COLUMN proof_packets.error_message IS 'Error message if packet generation failed';

COMMENT ON COLUMN audit_log.action IS 'Type of action performed (prompt_created, packet_generated, etc.)';
COMMENT ON COLUMN audit_log.entity_type IS 'Type of entity affected (evidence_prompt, proof_packet, etc.)';
COMMENT ON COLUMN audit_log.entity_id IS 'ID of the affected entity';
COMMENT ON COLUMN audit_log.details IS 'Additional details about the action performed';
COMMENT ON COLUMN audit_log.ip_address IS 'IP address of the user who performed the action';
COMMENT ON COLUMN audit_log.user_agent IS 'User agent of the client that performed the action';

-- Create function to automatically expire prompts
CREATE OR REPLACE FUNCTION expire_old_prompts()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE evidence_prompts 
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending' AND expires_at < NOW();
    
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to log audit events
CREATE OR REPLACE FUNCTION log_audit_event(
    p_user_id UUID,
    p_claim_id UUID,
    p_action audit_action,
    p_entity_type VARCHAR(50),
    p_entity_id UUID,
    p_details JSONB DEFAULT '{}'::jsonb,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    audit_id UUID;
BEGIN
    INSERT INTO audit_log (
        user_id, claim_id, action, entity_type, entity_id, 
        details, ip_address, user_agent
    ) VALUES (
        p_user_id, p_claim_id, p_action, p_entity_type, p_entity_id,
        p_details, p_ip_address, p_user_agent
    ) RETURNING id INTO audit_id;
    
    RETURN audit_id;
END;
$$ LANGUAGE plpgsql;
