-- Migration 064: Fix financial_events table for CSV ingestion compatibility
-- Adds missing columns and relaxes event_type constraint to match csvIngestionService.ts

-- Add missing columns that csvIngestionService.ts expects
ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS asin TEXT;
ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS store_id TEXT;
ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS sync_id TEXT;
ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'csv_upload';
ALTER TABLE financial_events ADD COLUMN IF NOT EXISTS description TEXT;

-- Drop the restrictive event_type CHECK constraint
-- The original constraint only allows: 'fee', 'reimbursement', 'return', 'shipment'
-- But CSV ingestion sends values like 'adjustment', 'FBALiquidationEvent', etc.
ALTER TABLE financial_events DROP CONSTRAINT IF EXISTS financial_events_event_type_check;

-- Add indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_financial_events_sku ON financial_events(sku);
CREATE INDEX IF NOT EXISTS idx_financial_events_asin ON financial_events(asin);
CREATE INDEX IF NOT EXISTS idx_financial_events_store_id ON financial_events(store_id);
CREATE INDEX IF NOT EXISTS idx_financial_events_sync_id ON financial_events(sync_id);
