-- ========================================
-- Complete Integrations Backend Schema
-- Migration: 005_complete_integrations_schema.sql
-- ========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- USERS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    company_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'manager')),
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- OAUTH_TOKENS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('amazon', 'gmail', 'stripe')),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type VARCHAR(50) DEFAULT 'Bearer',
    expires_at TIMESTAMP,
    scope TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider)
);

-- ========================================
-- INTEGRATION_ACCOUNTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS integration_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('amazon', 'gmail', 'stripe')),
    account_id VARCHAR(255),
    account_name VARCHAR(255),
    account_email VARCHAR(255),
    account_status VARCHAR(50) DEFAULT 'active',
    metadata JSONB,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider, account_id)
);

-- ========================================
-- AMAZON_INTEGRATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS amazon_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marketplace_id VARCHAR(50) NOT NULL,
    seller_id VARCHAR(255),
    region VARCHAR(50) DEFAULT 'us-east-1',
    api_access BOOLEAN DEFAULT false,
    reports_access BOOLEAN DEFAULT false,
    inventory_access BOOLEAN DEFAULT false,
    orders_access BOOLEAN DEFAULT false,
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, marketplace_id)
);

-- ========================================
-- GMAIL_INTEGRATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS gmail_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_address VARCHAR(255) NOT NULL,
    labels_access BOOLEAN DEFAULT false,
    emails_access BOOLEAN DEFAULT false,
    send_access BOOLEAN DEFAULT false,
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, gmail_address)
);

-- ========================================
-- STRIPE_INTEGRATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS stripe_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id VARCHAR(255) NOT NULL,
    account_name VARCHAR(255),
    account_type VARCHAR(50),
    charges_access BOOLEAN DEFAULT false,
    customers_access BOOLEAN DEFAULT false,
    subscriptions_access BOOLEAN DEFAULT false,
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, stripe_account_id)
);

-- ========================================
-- INVENTORY_ITEMS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sku VARCHAR(255) NOT NULL,
    title VARCHAR(500),
    description TEXT,
    category VARCHAR(255),
    brand VARCHAR(255),
    supplier VARCHAR(255),
    cost_price DECIMAL(10,2),
    selling_price DECIMAL(10,2),
    quantity_available INTEGER DEFAULT 0,
    quantity_reserved INTEGER DEFAULT 0,
    quantity_shipped INTEGER DEFAULT 0,
    reorder_point INTEGER DEFAULT 0,
    reorder_quantity INTEGER DEFAULT 0,
    weight DECIMAL(8,3),
    dimensions JSONB,
    tags TEXT[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, sku)
);

-- ========================================
-- INVENTORY_SYNC_LOGS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS inventory_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('amazon', 'gmail', 'stripe', 'manual')),
    sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('full', 'incremental', 'discrepancy')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    items_processed INTEGER DEFAULT 0,
    items_updated INTEGER DEFAULT 0,
    items_created INTEGER DEFAULT 0,
    items_deleted INTEGER DEFAULT 0,
    discrepancies_found INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    metadata JSONB
);

-- ========================================
-- DISCREPANCIES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS discrepancies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
    sku VARCHAR(255),
    discrepancy_type VARCHAR(50) NOT NULL CHECK (discrepancy_type IN ('quantity', 'price', 'status', 'metadata')),
    source_system VARCHAR(50) NOT NULL,
    source_value TEXT,
    target_system VARCHAR(50) NOT NULL,
    target_value TEXT,
    severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'ignored')),
    assigned_to UUID REFERENCES users(id),
    notes TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- CLAIMS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_type VARCHAR(50) NOT NULL CHECK (claim_type IN ('reimbursement', 'refund', 'adjustment', 'dispute')),
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('amazon', 'stripe', 'manual')),
    reference_id VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed')),
    reason TEXT,
    evidence TEXT[],
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- NOTIFICATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('email', 'inapp', 'push', 'sms')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
    metadata JSONB,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- API_LOGS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS api_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    ip_address INET,
    user_agent TEXT,
    request_body JSONB,
    response_body JSONB,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- WEBHOOK_EVENTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    provider VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_id VARCHAR(255),
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- INDEXES FOR PERFORMANCE
-- ========================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_at ON users(created_at);

-- OAuth Tokens
CREATE INDEX idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX idx_oauth_tokens_provider ON oauth_tokens(provider);
CREATE INDEX idx_oauth_tokens_expires_at ON oauth_tokens(expires_at);

-- Integration Accounts
CREATE INDEX idx_integration_accounts_user_id ON integration_accounts(user_id);
CREATE INDEX idx_integration_accounts_provider ON integration_accounts(provider);

-- Amazon Integrations
CREATE INDEX idx_amazon_integrations_user_id ON amazon_integrations(user_id);
CREATE INDEX idx_amazon_integrations_marketplace_id ON amazon_integrations(marketplace_id);
CREATE INDEX idx_amazon_integrations_sync_status ON amazon_integrations(sync_status);

-- Gmail Integrations
CREATE INDEX idx_gmail_integrations_user_id ON gmail_integrations(user_id);
CREATE INDEX idx_gmail_integrations_sync_status ON gmail_integrations(sync_status);

-- Stripe Integrations
CREATE INDEX idx_stripe_integrations_user_id ON stripe_integrations(user_id);
CREATE INDEX idx_stripe_integrations_sync_status ON stripe_integrations(sync_status);

-- Inventory Items
CREATE INDEX idx_inventory_items_user_id ON inventory_items(user_id);
CREATE INDEX idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX idx_inventory_items_category ON inventory_items(category);
CREATE INDEX idx_inventory_items_quantity_available ON inventory_items(quantity_available);

-- Inventory Sync Logs
CREATE INDEX idx_inventory_sync_logs_user_id ON inventory_sync_logs(user_id);
CREATE INDEX idx_inventory_sync_logs_provider ON inventory_sync_logs(provider);
CREATE INDEX idx_inventory_sync_logs_status ON inventory_sync_logs(status);
CREATE INDEX idx_inventory_sync_logs_started_at ON inventory_sync_logs(started_at);

-- Discrepancies
CREATE INDEX idx_discrepancies_user_id ON discrepancies(user_id);
CREATE INDEX idx_discrepancies_sku ON discrepancies(sku);
CREATE INDEX idx_discrepancies_status ON discrepancies(status);
CREATE INDEX idx_discrepancies_severity ON discrepancies(severity);

-- Claims
CREATE INDEX idx_claims_user_id ON claims(user_id);
CREATE INDEX idx_claims_provider ON claims(provider);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_submitted_at ON claims(submitted_at);

-- Notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- API Logs
CREATE INDEX idx_api_logs_user_id ON api_logs(user_id);
CREATE INDEX idx_api_logs_endpoint ON api_logs(endpoint);
CREATE INDEX idx_api_logs_status_code ON api_logs(status_code);
CREATE INDEX idx_api_logs_created_at ON api_logs(created_at);

-- Webhook Events
CREATE INDEX idx_webhook_events_user_id ON webhook_events(user_id);
CREATE INDEX idx_webhook_events_provider ON webhook_events(provider);
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at);

-- ========================================
-- TRIGGERS FOR UPDATED_AT
-- ========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_oauth_tokens_updated_at BEFORE UPDATE ON oauth_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_integration_accounts_updated_at BEFORE UPDATE ON integration_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_amazon_integrations_updated_at BEFORE UPDATE ON amazon_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gmail_integrations_updated_at BEFORE UPDATE ON gmail_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_stripe_integrations_updated_at BEFORE UPDATE ON stripe_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_discrepancies_updated_at BEFORE UPDATE ON discrepancies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- COMMENTS
-- ========================================

COMMENT ON TABLE users IS 'User accounts and authentication information';
COMMENT ON TABLE oauth_tokens IS 'OAuth access and refresh tokens for third-party integrations';
COMMENT ON TABLE integration_accounts IS 'Connected third-party service accounts';
COMMENT ON TABLE amazon_integrations IS 'Amazon SP-API integration details and status';
COMMENT ON TABLE gmail_integrations IS 'Gmail API integration details and status';
COMMENT ON TABLE stripe_integrations IS 'Stripe API integration details and status';
COMMENT ON TABLE inventory_items IS 'Inventory items with SKU tracking and management';
COMMENT ON TABLE inventory_sync_logs IS 'Logs of inventory synchronization operations';
COMMENT ON TABLE discrepancies IS 'Inventory discrepancies between different systems';
COMMENT ON TABLE claims IS 'Reimbursement and refund claims';
COMMENT ON TABLE notifications IS 'User notifications across different channels';
COMMENT ON TABLE api_logs IS 'API request and response logging for monitoring';
COMMENT ON TABLE webhook_events IS 'Incoming webhook events from third-party services';


-- Complete Integrations Backend Schema
-- Migration: 005_complete_integrations_schema.sql
-- ========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- USERS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    company_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'manager')),
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- OAUTH_TOKENS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('amazon', 'gmail', 'stripe')),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type VARCHAR(50) DEFAULT 'Bearer',
    expires_at TIMESTAMP,
    scope TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider)
);

-- ========================================
-- INTEGRATION_ACCOUNTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS integration_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('amazon', 'gmail', 'stripe')),
    account_id VARCHAR(255),
    account_name VARCHAR(255),
    account_email VARCHAR(255),
    account_status VARCHAR(50) DEFAULT 'active',
    metadata JSONB,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider, account_id)
);

-- ========================================
-- AMAZON_INTEGRATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS amazon_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marketplace_id VARCHAR(50) NOT NULL,
    seller_id VARCHAR(255),
    region VARCHAR(50) DEFAULT 'us-east-1',
    api_access BOOLEAN DEFAULT false,
    reports_access BOOLEAN DEFAULT false,
    inventory_access BOOLEAN DEFAULT false,
    orders_access BOOLEAN DEFAULT false,
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, marketplace_id)
);

-- ========================================
-- GMAIL_INTEGRATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS gmail_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_address VARCHAR(255) NOT NULL,
    labels_access BOOLEAN DEFAULT false,
    emails_access BOOLEAN DEFAULT false,
    send_access BOOLEAN DEFAULT false,
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, gmail_address)
);

-- ========================================
-- STRIPE_INTEGRATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS stripe_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id VARCHAR(255) NOT NULL,
    account_name VARCHAR(255),
    account_type VARCHAR(50),
    charges_access BOOLEAN DEFAULT false,
    customers_access BOOLEAN DEFAULT false,
    subscriptions_access BOOLEAN DEFAULT false,
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, stripe_account_id)
);

-- ========================================
-- INVENTORY_ITEMS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sku VARCHAR(255) NOT NULL,
    title VARCHAR(500),
    description TEXT,
    category VARCHAR(255),
    brand VARCHAR(255),
    supplier VARCHAR(255),
    cost_price DECIMAL(10,2),
    selling_price DECIMAL(10,2),
    quantity_available INTEGER DEFAULT 0,
    quantity_reserved INTEGER DEFAULT 0,
    quantity_shipped INTEGER DEFAULT 0,
    reorder_point INTEGER DEFAULT 0,
    reorder_quantity INTEGER DEFAULT 0,
    weight DECIMAL(8,3),
    dimensions JSONB,
    tags TEXT[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, sku)
);

-- ========================================
-- INVENTORY_SYNC_LOGS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS inventory_sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('amazon', 'gmail', 'stripe', 'manual')),
    sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('full', 'incremental', 'discrepancy')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    items_processed INTEGER DEFAULT 0,
    items_updated INTEGER DEFAULT 0,
    items_created INTEGER DEFAULT 0,
    items_deleted INTEGER DEFAULT 0,
    discrepancies_found INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    metadata JSONB
);

-- ========================================
-- DISCREPANCIES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS discrepancies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
    sku VARCHAR(255),
    discrepancy_type VARCHAR(50) NOT NULL CHECK (discrepancy_type IN ('quantity', 'price', 'status', 'metadata')),
    source_system VARCHAR(50) NOT NULL,
    source_value TEXT,
    target_system VARCHAR(50) NOT NULL,
    target_value TEXT,
    severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'ignored')),
    assigned_to UUID REFERENCES users(id),
    notes TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- CLAIMS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_type VARCHAR(50) NOT NULL CHECK (claim_type IN ('reimbursement', 'refund', 'adjustment', 'dispute')),
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('amazon', 'stripe', 'manual')),
    reference_id VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed')),
    reason TEXT,
    evidence TEXT[],
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- NOTIFICATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('email', 'inapp', 'push', 'sms')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
    metadata JSONB,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- API_LOGS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS api_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    ip_address INET,
    user_agent TEXT,
    request_body JSONB,
    response_body JSONB,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- WEBHOOK_EVENTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    provider VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_id VARCHAR(255),
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- INDEXES FOR PERFORMANCE
-- ========================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_at ON users(created_at);

-- OAuth Tokens
CREATE INDEX idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX idx_oauth_tokens_provider ON oauth_tokens(provider);
CREATE INDEX idx_oauth_tokens_expires_at ON oauth_tokens(expires_at);

-- Integration Accounts
CREATE INDEX idx_integration_accounts_user_id ON integration_accounts(user_id);
CREATE INDEX idx_integration_accounts_provider ON integration_accounts(provider);

-- Amazon Integrations
CREATE INDEX idx_amazon_integrations_user_id ON amazon_integrations(user_id);
CREATE INDEX idx_amazon_integrations_marketplace_id ON amazon_integrations(marketplace_id);
CREATE INDEX idx_amazon_integrations_sync_status ON amazon_integrations(sync_status);

-- Gmail Integrations
CREATE INDEX idx_gmail_integrations_user_id ON gmail_integrations(user_id);
CREATE INDEX idx_gmail_integrations_sync_status ON gmail_integrations(sync_status);

-- Stripe Integrations
CREATE INDEX idx_stripe_integrations_user_id ON stripe_integrations(user_id);
CREATE INDEX idx_stripe_integrations_sync_status ON stripe_integrations(sync_status);

-- Inventory Items
CREATE INDEX idx_inventory_items_user_id ON inventory_items(user_id);
CREATE INDEX idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX idx_inventory_items_category ON inventory_items(category);
CREATE INDEX idx_inventory_items_quantity_available ON inventory_items(quantity_available);

-- Inventory Sync Logs
CREATE INDEX idx_inventory_sync_logs_user_id ON inventory_sync_logs(user_id);
CREATE INDEX idx_inventory_sync_logs_provider ON inventory_sync_logs(provider);
CREATE INDEX idx_inventory_sync_logs_status ON inventory_sync_logs(status);
CREATE INDEX idx_inventory_sync_logs_started_at ON inventory_sync_logs(started_at);

-- Discrepancies
CREATE INDEX idx_discrepancies_user_id ON discrepancies(user_id);
CREATE INDEX idx_discrepancies_sku ON discrepancies(sku);
CREATE INDEX idx_discrepancies_status ON discrepancies(status);
CREATE INDEX idx_discrepancies_severity ON discrepancies(severity);

-- Claims
CREATE INDEX idx_claims_user_id ON claims(user_id);
CREATE INDEX idx_claims_provider ON claims(provider);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_submitted_at ON claims(submitted_at);

-- Notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- API Logs
CREATE INDEX idx_api_logs_user_id ON api_logs(user_id);
CREATE INDEX idx_api_logs_endpoint ON api_logs(endpoint);
CREATE INDEX idx_api_logs_status_code ON api_logs(status_code);
CREATE INDEX idx_api_logs_created_at ON api_logs(created_at);

-- Webhook Events
CREATE INDEX idx_webhook_events_user_id ON webhook_events(user_id);
CREATE INDEX idx_webhook_events_provider ON webhook_events(provider);
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at);

-- ========================================
-- TRIGGERS FOR UPDATED_AT
-- ========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_oauth_tokens_updated_at BEFORE UPDATE ON oauth_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_integration_accounts_updated_at BEFORE UPDATE ON integration_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_amazon_integrations_updated_at BEFORE UPDATE ON amazon_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_gmail_integrations_updated_at BEFORE UPDATE ON gmail_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_stripe_integrations_updated_at BEFORE UPDATE ON stripe_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_discrepancies_updated_at BEFORE UPDATE ON discrepancies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_claims_updated_at BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- COMMENTS
-- ========================================

COMMENT ON TABLE users IS 'User accounts and authentication information';
COMMENT ON TABLE oauth_tokens IS 'OAuth access and refresh tokens for third-party integrations';
COMMENT ON TABLE integration_accounts IS 'Connected third-party service accounts';
COMMENT ON TABLE amazon_integrations IS 'Amazon SP-API integration details and status';
COMMENT ON TABLE gmail_integrations IS 'Gmail API integration details and status';
COMMENT ON TABLE stripe_integrations IS 'Stripe API integration details and status';
COMMENT ON TABLE inventory_items IS 'Inventory items with SKU tracking and management';
COMMENT ON TABLE inventory_sync_logs IS 'Logs of inventory synchronization operations';
COMMENT ON TABLE discrepancies IS 'Inventory discrepancies between different systems';
COMMENT ON TABLE claims IS 'Reimbursement and refund claims';
COMMENT ON TABLE notifications IS 'User notifications across different channels';
COMMENT ON TABLE api_logs IS 'API request and response logging for monitoring';
COMMENT ON TABLE webhook_events IS 'Incoming webhook events from third-party services';


