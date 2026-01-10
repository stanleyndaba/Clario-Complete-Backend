-- ========================================
-- Migration: 045_add_soft_delete_columns.sql
-- Multi-Tenant SaaS: Soft Delete for Data Retention
-- ========================================

-- Add deleted_at to critical tables for compliance

-- Core entities
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Business data (90-day soft delete period)
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE evidence_documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE recoveries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Supporting data
ALTER TABLE evidence_sources ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Indexes for soft delete queries (filter out deleted records efficiently)
CREATE INDEX IF NOT EXISTS idx_tenants_not_deleted ON tenants(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_not_deleted ON tenant_memberships(tenant_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_not_deleted ON users(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_dispute_cases_not_deleted ON dispute_cases(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_detection_results_not_deleted ON detection_results(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_evidence_documents_not_deleted ON evidence_documents(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recoveries_not_deleted ON recoveries(tenant_id) WHERE deleted_at IS NULL;

-- Create views that exclude soft-deleted records (for convenience)
CREATE OR REPLACE VIEW active_tenants AS
SELECT * FROM tenants WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_tenant_memberships AS
SELECT * FROM tenant_memberships WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE OR REPLACE VIEW active_users AS
SELECT * FROM users WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_dispute_cases AS
SELECT * FROM dispute_cases WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW active_recoveries AS
SELECT * FROM recoveries WHERE deleted_at IS NULL;

-- Documentation
COMMENT ON COLUMN tenants.deleted_at IS 'Soft delete timestamp - 30 day retention, 90 day purge';
COMMENT ON COLUMN dispute_cases.deleted_at IS 'Soft delete timestamp - 90 day retention, 1 year purge for compliance';
COMMENT ON COLUMN recoveries.deleted_at IS 'Soft delete timestamp - financial records retained 7 years';
