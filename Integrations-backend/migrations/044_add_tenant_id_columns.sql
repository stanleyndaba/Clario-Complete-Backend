-- ========================================
-- Migration: 044_add_tenant_id_columns.sql
-- Multi-Tenant SaaS: Add tenant_id to ALL tables (nullable for safe migration)
-- ========================================

-- This migration adds tenant_id as NULLABLE first
-- Constraints will be added in migration 048 after backfill

-- Core Data Tables
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Financial Events & Detection
ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE detection_queue ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE detection_thresholds ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE detection_whitelist ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Dispute System
ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE dispute_automation_rules ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE dispute_audit_log ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Evidence System
ALTER TABLE evidence_sources ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE evidence_documents ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE evidence_line_items ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE dispute_evidence_links ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE proof_packets ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE smart_prompts ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Add to evidence_match_results if exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_match_results') THEN
    ALTER TABLE evidence_match_results ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

-- Worker Job Tables
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'parser_jobs') THEN
    ALTER TABLE parser_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ingestion_jobs') THEN
    ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'filing_jobs') THEN
    ALTER TABLE filing_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_jobs') THEN
    ALTER TABLE billing_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

-- Recoveries
ALTER TABLE recoveries ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- System Tables
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- Add to learning tables if they exist
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_insights') THEN
    ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'threshold_optimizations') THEN
    ALTER TABLE threshold_optimizations ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

-- Sync Tables
ALTER TABLE sync_detection_triggers ADD COLUMN IF NOT EXISTS tenant_id UUID;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_snapshots') THEN
    ALTER TABLE sync_snapshots ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'realtime_alerts') THEN
    ALTER TABLE realtime_alerts ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

-- Access/User Tables
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_tenant_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'referral_invites') THEN
    ALTER TABLE referral_invites ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_proxy_assignments') THEN
    ALTER TABLE seller_proxy_assignments ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notes') THEN
    ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

-- Error logging tables
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_ingestion_errors') THEN
    ALTER TABLE evidence_ingestion_errors ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_errors') THEN
    ALTER TABLE billing_errors ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
END $$;

-- Documentation
COMMENT ON COLUMN dispute_cases.tenant_id IS 'Tenant isolation key - all queries must filter by this';
COMMENT ON COLUMN detection_results.tenant_id IS 'Tenant isolation key';
COMMENT ON COLUMN tokens.tenant_id IS 'Tenant that owns this OAuth token';
