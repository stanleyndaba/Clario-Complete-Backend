-- Zero-Effort Evidence Loop Database Schema
-- Complete implementation for smart prompts, auto-submit, and proof packets

-- Create ENUM types for zero-effort evidence
CREATE TYPE proof_packet_status AS ENUM (
    'generating',
    'ready',
    'failed',
    'expired'
);

CREATE TYPE audit_action_type AS ENUM (
    'smart_prompt_created',
    'smart_prompt_answered',
    'smart_prompt_dismissed',
    'auto_submit_triggered',
    'auto_submit_success',
    'auto_submit_failed',
    'proof_packet_generated',
    'evidence_matched',
    'dispute_status_updated'
);

-- Add user_id to smart_prompts table
ALTER TABLE smart_prompts 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Create proof_packets table
CREATE TABLE IF NOT EXISTS proof_packets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url VARCHAR(500) NOT NULL,
    status proof_packet_status NOT NULL DEFAULT 'generating',
    payout_amount DECIMAL(10,2),
    size_bytes BIGINT,
    document_count INTEGER DEFAULT 0,
    generated_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_type audit_action_type NOT NULL,
    resource_id VARCHAR(255),
    details JSONB NOT NULL DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create payout_webhooks table
CREATE TABLE IF NOT EXISTS payout_webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dispute_id UUID NOT NULL REFERENCES dispute_cases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    payout_date TIMESTAMP WITH TIME ZONE NOT NULL,
    webhook_data JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create feature_flags table for canary rollout
CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_name VARCHAR(100) NOT NULL UNIQUE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    canary_users JSONB DEFAULT '[]',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create user_feature_flags table for per-user feature access
CREATE TABLE IF NOT EXISTS user_feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flag_name VARCHAR(100) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, flag_name)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_smart_prompts_user_id ON smart_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_status_expires ON smart_prompts(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_smart_prompts_user_status ON smart_prompts(user_id, status);

CREATE INDEX IF NOT EXISTS idx_proof_packets_user_id ON proof_packets(user_id);
CREATE INDEX IF NOT EXISTS idx_proof_packets_dispute_id ON proof_packets(dispute_id);
CREATE INDEX IF NOT EXISTS idx_proof_packets_status ON proof_packets(status);
CREATE INDEX IF NOT EXISTS idx_proof_packets_created_at ON proof_packets(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id ON audit_logs(resource_id);

CREATE INDEX IF NOT EXISTS idx_payout_webhooks_user_id ON payout_webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_payout_webhooks_dispute_id ON payout_webhooks(dispute_id);
CREATE INDEX IF NOT EXISTS idx_payout_webhooks_status ON payout_webhooks(status);
CREATE INDEX IF NOT EXISTS idx_payout_webhooks_created_at ON payout_webhooks(created_at);

CREATE INDEX IF NOT EXISTS idx_user_feature_flags_user_id ON user_feature_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feature_flags_flag_name ON user_feature_flags(flag_name);
CREATE INDEX IF NOT EXISTS idx_user_feature_flags_enabled ON user_feature_flags(is_enabled);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_audit_logs_details_gin ON audit_logs USING GIN(details);
CREATE INDEX IF NOT EXISTS idx_payout_webhooks_webhook_data_gin ON payout_webhooks USING GIN(webhook_data);
CREATE INDEX IF NOT EXISTS idx_feature_flags_canary_users_gin ON feature_flags USING GIN(canary_users);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_smart_prompts_user_status_expires ON smart_prompts(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_proof_packets_user_status_created ON proof_packets(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action_created ON audit_logs(user_id, action_type, created_at);
CREATE INDEX IF NOT EXISTS idx_payout_webhooks_user_status_created ON payout_webhooks(user_id, status, created_at);

-- Add updated_at triggers
CREATE TRIGGER update_proof_packets_updated_at 
    BEFORE UPDATE ON proof_packets 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_feature_flags_updated_at 
    BEFORE UPDATE ON feature_flags 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default feature flags
INSERT INTO feature_flags (flag_name, is_enabled, rollout_percentage, description) VALUES
('EV_AUTO_SUBMIT', true, 100, 'Enable auto-submit for high-confidence evidence matches'),
('EV_SMART_PROMPTS', true, 100, 'Enable smart prompts for ambiguous evidence matches'),
('EV_PROOF_PACKETS', true, 100, 'Enable proof packet generation after payout'),
('EV_CANARY_ROLLOUT', false, 5, 'Canary rollout for first 5 beta users')
ON CONFLICT (flag_name) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE proof_packets IS 'Proof packets generated after successful payouts';
COMMENT ON TABLE audit_logs IS 'Audit trail for all evidence-related actions';
COMMENT ON TABLE payout_webhooks IS 'Payout webhooks for triggering proof packet generation';
COMMENT ON TABLE feature_flags IS 'Feature flags for canary rollout and A/B testing';
COMMENT ON TABLE user_feature_flags IS 'Per-user feature flag overrides';

COMMENT ON COLUMN proof_packets.url IS 'Signed URL to download the proof packet';
COMMENT ON COLUMN proof_packets.status IS 'Current status of proof packet generation';
COMMENT ON COLUMN proof_packets.payout_amount IS 'Amount of the payout that triggered this packet';
COMMENT ON COLUMN proof_packets.size_bytes IS 'Size of the proof packet in bytes';
COMMENT ON COLUMN proof_packets.document_count IS 'Number of evidence documents included';
COMMENT ON COLUMN proof_packets.generated_at IS 'When the proof packet was generated';
COMMENT ON COLUMN proof_packets.expires_at IS 'When the proof packet download link expires';

COMMENT ON COLUMN audit_logs.action_type IS 'Type of action being audited';
COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the resource being acted upon';
COMMENT ON COLUMN audit_logs.details IS 'JSON details of the action';
COMMENT ON COLUMN audit_logs.ip_address IS 'IP address of the user performing the action';
COMMENT ON COLUMN audit_logs.user_agent IS 'User agent of the client';

COMMENT ON COLUMN payout_webhooks.amount IS 'Amount of the payout';
COMMENT ON COLUMN payout_webhooks.payout_date IS 'Date of the payout';
COMMENT ON COLUMN payout_webhooks.webhook_data IS 'Raw webhook data from payment provider';
COMMENT ON COLUMN payout_webhooks.status IS 'Processing status of the webhook';

COMMENT ON COLUMN feature_flags.rollout_percentage IS 'Percentage of users to include in rollout (0-100)';
COMMENT ON COLUMN feature_flags.canary_users IS 'Array of specific user IDs for canary testing';
COMMENT ON COLUMN feature_flags.description IS 'Human-readable description of the feature flag';

COMMENT ON COLUMN user_feature_flags.flag_name IS 'Name of the feature flag';
COMMENT ON COLUMN user_feature_flags.is_enabled IS 'Whether the feature is enabled for this user';
COMMENT ON COLUMN user_feature_flags.granted_at IS 'When the feature access was granted';

