-- Security & Encryption Database Schema
-- Phase 6: Security & Privacy implementation

-- Create ENUM types for security functionality
CREATE TYPE key_status AS ENUM (
    'active',
    'rotated',
    'expired',
    'revoked'
);

CREATE TYPE key_type AS ENUM (
    'master',
    'data',
    'audit',
    'proof_packet'
);

CREATE TYPE access_level AS ENUM (
    'read',
    'write',
    'admin',
    'audit'
);

CREATE TYPE audit_severity AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);

-- Encryption keys table
CREATE TABLE IF NOT EXISTS encryption_keys (
    id VARCHAR(255) PRIMARY KEY,
    key_type key_type NOT NULL,
    key_value TEXT NOT NULL, -- Base64 encoded key
    status key_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    rotated_at TIMESTAMP WITH TIME ZONE,
    rotated_from VARCHAR(255) REFERENCES encryption_keys(id),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- User roles and permissions
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_name VARCHAR(100) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Service accounts and API keys
CREATE TABLE IF NOT EXISTS service_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    api_key_hash VARCHAR(255) NOT NULL, -- SHA-256 hash of API key
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Enhanced audit log with security context
CREATE TABLE IF NOT EXISTS security_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    service_account_id UUID REFERENCES service_accounts(id) ON DELETE SET NULL,
    session_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    severity audit_severity NOT NULL DEFAULT 'medium',
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(255),
    response_status INTEGER,
    response_time_ms INTEGER,
    error_message TEXT,
    security_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    encrypted_data JSONB, -- Encrypted sensitive data
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Data retention policies
CREATE TABLE IF NOT EXISTS data_retention_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name VARCHAR(255) NOT NULL,
    retention_days INTEGER NOT NULL,
    cleanup_frequency_days INTEGER NOT NULL DEFAULT 7,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_cleanup_at TIMESTAMP WITH TIME ZONE,
    next_cleanup_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Security incidents and alerts
CREATE TABLE IF NOT EXISTS security_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_type VARCHAR(100) NOT NULL,
    severity audit_severity NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    affected_user_id UUID REFERENCES users(id),
    affected_resource VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_encryption_keys_type_status ON encryption_keys(key_type, status);
CREATE INDEX IF NOT EXISTS idx_encryption_keys_expires_at ON encryption_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_encryption_keys_rotated_from ON encryption_keys(rotated_from);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_name ON user_roles(role_name);
CREATE INDEX IF NOT EXISTS idx_user_roles_is_active ON user_roles(is_active);
CREATE INDEX IF NOT EXISTS idx_user_roles_expires_at ON user_roles(expires_at);

CREATE INDEX IF NOT EXISTS idx_service_accounts_api_key_hash ON service_accounts(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_service_accounts_is_active ON service_accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_service_accounts_expires_at ON service_accounts(expires_at);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_user_id ON security_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_action ON security_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_resource_type ON security_audit_log(resource_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_severity ON security_audit_log(severity);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_created_at ON security_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_ip_address ON security_audit_log(ip_address);

CREATE INDEX IF NOT EXISTS idx_data_retention_policies_table_name ON data_retention_policies(table_name);
CREATE INDEX IF NOT EXISTS idx_data_retention_policies_is_active ON data_retention_policies(is_active);
CREATE INDEX IF NOT EXISTS idx_data_retention_policies_next_cleanup ON data_retention_policies(next_cleanup_at);

CREATE INDEX IF NOT EXISTS idx_security_incidents_type ON security_incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_security_incidents_severity ON security_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_security_incidents_status ON security_incidents(status);
CREATE INDEX IF NOT EXISTS idx_security_incidents_created_at ON security_incidents(created_at);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_encryption_keys_metadata_gin ON encryption_keys USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_user_roles_permissions_gin ON user_roles USING GIN(permissions);
CREATE INDEX IF NOT EXISTS idx_user_roles_metadata_gin ON user_roles USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_service_accounts_permissions_gin ON service_accounts USING GIN(permissions);
CREATE INDEX IF NOT EXISTS idx_service_accounts_metadata_gin ON service_accounts USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_security_context_gin ON security_audit_log USING GIN(security_context);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_encrypted_data_gin ON security_audit_log USING GIN(encrypted_data);
CREATE INDEX IF NOT EXISTS idx_data_retention_policies_metadata_gin ON data_retention_policies USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_security_incidents_metadata_gin ON security_incidents USING GIN(metadata);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_roles_user_active ON user_roles(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_user_action ON security_audit_log(user_id, action);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_severity_created ON security_audit_log(severity, created_at);
CREATE INDEX IF NOT EXISTS idx_security_incidents_severity_status ON security_incidents(severity, status);

-- Add updated_at triggers
CREATE TRIGGER update_data_retention_policies_updated_at 
    BEFORE UPDATE ON data_retention_policies 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_security_incidents_updated_at 
    BEFORE UPDATE ON security_incidents 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create functions for security operations
CREATE OR REPLACE FUNCTION log_security_event(
    p_user_id UUID,
    p_service_account_id UUID,
    p_session_id VARCHAR(255),
    p_action VARCHAR(100),
    p_resource_type VARCHAR(100),
    p_resource_id VARCHAR(255),
    p_severity audit_severity,
    p_ip_address INET,
    p_user_agent TEXT,
    p_request_id VARCHAR(255),
    p_response_status INTEGER,
    p_response_time_ms INTEGER,
    p_error_message TEXT,
    p_security_context JSONB,
    p_encrypted_data JSONB
)
RETURNS UUID AS $$
DECLARE
    event_id UUID;
BEGIN
    INSERT INTO security_audit_log (
        user_id, service_account_id, session_id, action, resource_type, resource_id,
        severity, ip_address, user_agent, request_id, response_status, response_time_ms,
        error_message, security_context, encrypted_data
    ) VALUES (
        p_user_id, p_service_account_id, p_session_id, p_action, p_resource_type, p_resource_id,
        p_severity, p_ip_address, p_user_agent, p_request_id, p_response_status, p_response_time_ms,
        p_error_message, p_security_context, p_encrypted_data
    ) RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to check user permissions
CREATE OR REPLACE FUNCTION check_user_permission(
    p_user_id UUID,
    p_permission VARCHAR(100),
    p_resource_type VARCHAR(100) DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    has_permission BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM user_roles ur
        WHERE ur.user_id = p_user_id
        AND ur.is_active = TRUE
        AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        AND (
            ur.permissions @> jsonb_build_array(p_permission)
            OR ur.permissions @> jsonb_build_array('admin')
        )
    ) INTO has_permission;
    
    RETURN has_permission;
END;
$$ LANGUAGE plpgsql;

-- Create function to get data retention policies
CREATE OR REPLACE FUNCTION get_retention_policies()
RETURNS TABLE (
    table_name VARCHAR(255),
    retention_days INTEGER,
    cleanup_frequency_days INTEGER,
    last_cleanup_at TIMESTAMP WITH TIME ZONE,
    next_cleanup_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        drp.table_name,
        drp.retention_days,
        drp.cleanup_frequency_days,
        drp.last_cleanup_at,
        drp.next_cleanup_at
    FROM data_retention_policies drp
    WHERE drp.is_active = TRUE
    ORDER BY drp.table_name;
END;
$$ LANGUAGE plpgsql;

-- Create function to schedule next cleanup
CREATE OR REPLACE FUNCTION schedule_next_cleanup(
    p_table_name VARCHAR(255)
)
RETURNS VOID AS $$
BEGIN
    UPDATE data_retention_policies 
    SET 
        last_cleanup_at = NOW(),
        next_cleanup_at = NOW() + INTERVAL '1 day' * cleanup_frequency_days,
        updated_at = NOW()
    WHERE table_name = p_table_name;
END;
$$ LANGUAGE plpgsql;

-- Insert default data retention policies
INSERT INTO data_retention_policies (table_name, retention_days, cleanup_frequency_days) VALUES
('evidence_prompts', 90, 7),
('proof_packets', 2555, 30), -- 7 years for compliance
('security_audit_log', 2555, 30), -- 7 years for compliance
('audit_log', 2555, 30), -- 7 years for compliance
('dispute_submissions', 1825, 30), -- 5 years
('evidence_matching_results', 365, 30), -- 1 year
('parser_jobs', 30, 7), -- 30 days
('parser_job_results', 90, 7) -- 90 days
ON CONFLICT (table_name) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE encryption_keys IS 'Encryption keys for data protection';
COMMENT ON TABLE user_roles IS 'User roles and permissions for RBAC';
COMMENT ON TABLE service_accounts IS 'Service accounts and API keys for system access';
COMMENT ON TABLE security_audit_log IS 'Enhanced audit log with security context';
COMMENT ON TABLE data_retention_policies IS 'Data retention and cleanup policies';
COMMENT ON TABLE security_incidents IS 'Security incidents and alerts';

COMMENT ON COLUMN encryption_keys.key_value IS 'Base64 encoded encryption key';
COMMENT ON COLUMN encryption_keys.rotated_from IS 'Key ID that this key was rotated from';
COMMENT ON COLUMN user_roles.permissions IS 'Array of permission strings';
COMMENT ON COLUMN user_roles.expires_at IS 'When the role expires (NULL for permanent)';
COMMENT ON COLUMN service_accounts.api_key_hash IS 'SHA-256 hash of the API key';
COMMENT ON COLUMN security_audit_log.encrypted_data IS 'Encrypted sensitive data';
COMMENT ON COLUMN security_audit_log.security_context IS 'Additional security context';
COMMENT ON COLUMN data_retention_policies.retention_days IS 'Days to retain data before cleanup';
COMMENT ON COLUMN data_retention_policies.cleanup_frequency_days IS 'How often to run cleanup';
