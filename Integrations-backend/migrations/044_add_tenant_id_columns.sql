-- ========================================
-- Migration: 044_add_tenant_id_columns.sql
-- Multi-Tenant SaaS: Add tenant_id to ALL tables (nullable for safe migration)
-- SAFE VERSION: Uses IF EXISTS checks for all tables
-- ========================================

-- This migration adds tenant_id as NULLABLE first
-- Constraints will be added in migration 048 after backfill

DO $$
BEGIN
  -- Core Data Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'shipments') THEN
    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'returns') THEN
    ALTER TABLE returns ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'settlements') THEN
    ALTER TABLE settlements ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory') THEN
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Financial Events & Detection
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_events') THEN
    ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_results') THEN
    ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_queue') THEN
    ALTER TABLE detection_queue ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_thresholds') THEN
    ALTER TABLE detection_thresholds ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'detection_whitelist') THEN
    ALTER TABLE detection_whitelist ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Dispute System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_cases') THEN
    ALTER TABLE dispute_cases ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_automation_rules') THEN
    ALTER TABLE dispute_automation_rules ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence') THEN
    ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_audit_log') THEN
    ALTER TABLE dispute_audit_log ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Evidence System
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_sources') THEN
    ALTER TABLE evidence_sources ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_documents') THEN
    ALTER TABLE evidence_documents ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_line_items') THEN
    ALTER TABLE evidence_line_items ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_evidence_links') THEN
    ALTER TABLE dispute_evidence_links ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proof_packets') THEN
    ALTER TABLE proof_packets ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'smart_prompts') THEN
    ALTER TABLE smart_prompts ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_match_results') THEN
    ALTER TABLE evidence_match_results ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Worker Job Tables
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

  -- Recoveries
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recoveries') THEN
    ALTER TABLE recoveries ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- System Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_events') THEN
    ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learning_insights') THEN
    ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'threshold_optimizations') THEN
    ALTER TABLE threshold_optimizations ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Sync Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_detection_triggers') THEN
    ALTER TABLE sync_detection_triggers ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_snapshots') THEN
    ALTER TABLE sync_snapshots ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'realtime_alerts') THEN
    ALTER TABLE realtime_alerts ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Access/User Tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tokens') THEN
    ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_tenant_id UUID;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'referral_invites') THEN
    ALTER TABLE referral_invites ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seller_proxy_assignments') THEN
    ALTER TABLE seller_proxy_assignments ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_notes') THEN
    ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  -- Error logging tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'evidence_ingestion_errors') THEN
    ALTER TABLE evidence_ingestion_errors ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'billing_errors') THEN
    ALTER TABLE billing_errors ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;
  
  -- Dispute submissions
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispute_submissions') THEN
    ALTER TABLE dispute_submissions ADD COLUMN IF NOT EXISTS tenant_id UUID;
  END IF;

  RAISE NOTICE 'Migration 044 completed - tenant_id columns added to all existing tables';
END $$;
