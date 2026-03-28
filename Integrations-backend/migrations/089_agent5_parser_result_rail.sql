-- Migration: 089_agent5_parser_result_rail
-- Purpose: Create a durable Agent 5 parser result rail for completed document parses

CREATE TABLE IF NOT EXISTS parser_job_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES evidence_documents(id) ON DELETE CASCADE,
  parser_job_id UUID REFERENCES parser_jobs(id) ON DELETE SET NULL,
  seller_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed')),
  supplier_name TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  total_amount NUMERIC(18, 2),
  currency TEXT,
  tax_amount NUMERIC(18, 2),
  shipping_amount NUMERIC(18, 2),
  payment_terms TEXT,
  po_number TEXT,
  raw_text TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  structured_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_method TEXT,
  confidence_score NUMERIC(5, 4),
  processing_time_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parser_job_results_document
  ON parser_job_results(document_id);

CREATE INDEX IF NOT EXISTS idx_parser_job_results_tenant_created
  ON parser_job_results(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_parser_job_results_parser_job
  ON parser_job_results(parser_job_id);

CREATE INDEX IF NOT EXISTS idx_parser_job_results_seller
  ON parser_job_results(seller_id, created_at DESC);

ALTER TABLE parser_job_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'parser_job_results'
      AND policyname = 'parser_job_results_owner_select'
  ) THEN
    CREATE POLICY parser_job_results_owner_select
      ON parser_job_results
      FOR SELECT
      USING (
        auth.uid() = user_id
        OR auth.uid()::text = seller_id
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'parser_job_results'
      AND policyname = 'parser_job_results_owner_insert'
  ) THEN
    CREATE POLICY parser_job_results_owner_insert
      ON parser_job_results
      FOR INSERT
      WITH CHECK (
        auth.uid() = user_id
        OR auth.uid()::text = seller_id
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'parser_job_results'
      AND policyname = 'parser_job_results_owner_update'
  ) THEN
    CREATE POLICY parser_job_results_owner_update
      ON parser_job_results
      FOR UPDATE
      USING (
        auth.uid() = user_id
        OR auth.uid()::text = seller_id
      );
  END IF;
END $$;

COMMENT ON TABLE parser_job_results IS 'Durable normalized parser outputs for Agent 5. One latest result row per evidence document.';
