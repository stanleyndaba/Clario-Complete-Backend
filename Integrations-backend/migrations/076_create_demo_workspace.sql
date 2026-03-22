-- Migration: 076_create_demo_workspace.sql
-- Purpose: Create a strictly isolated read-only demo workspace with seed data
-- Safety: All seeded rows are scoped only to the demo tenant and never mixed into live tenants.

INSERT INTO tenants (
  id,
  name,
  slug,
  status,
  plan,
  settings,
  metadata
) VALUES (
  '00000000-0000-0000-0000-0000000000d0',
  'Demo Workspace',
  'demo-workspace',
  'read_only',
  'professional',
  jsonb_build_object(
    'demo_workspace', true,
    'read_only_reason', 'Isolated demo workspace for launch previews'
  ),
  jsonb_build_object(
    'is_demo_workspace', true,
    'seed_version', '076_create_demo_workspace',
    'seeded_at', NOW()::text,
    'live_data_mixed', false
  )
) ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  plan = EXCLUDED.plan,
  settings = COALESCE(tenants.settings, '{}'::jsonb) || EXCLUDED.settings,
  metadata = COALESCE(tenants.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  deleted_at = NULL;

WITH demo_tenant AS (
  SELECT id
  FROM tenants
  WHERE slug = 'demo-workspace'
)
INSERT INTO stores (
  id,
  tenant_id,
  name,
  marketplace,
  seller_id,
  is_active,
  automation_enabled,
  metadata
)
SELECT
  '00000000-0000-0000-0000-0000000000d1',
  demo_tenant.id,
  'Demo FBA Workspace',
  'amazon_us',
  'DEMO-SELLER-001',
  true,
  false,
  jsonb_build_object('demo_workspace', true)
FROM demo_tenant
ON CONFLICT (id) DO NOTHING;

WITH demo_tenant AS (
  SELECT id
  FROM tenants
  WHERE slug = 'demo-workspace'
)
INSERT INTO detection_results (
  id,
  tenant_id,
  store_id,
  seller_id,
  sync_id,
  anomaly_type,
  severity,
  estimated_value,
  currency,
  confidence_score,
  evidence,
  status,
  created_at,
  updated_at
)
SELECT * FROM (
  VALUES
    ('00000000-0000-0000-0000-000000000201'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', 'demo-sync-20260322', 'missing_unit', 'medium', 128.40::numeric, 'USD', 0.82::numeric, jsonb_build_object('scenario', 'missing_evidence'), 'pending', NOW() - INTERVAL '7 days', NOW() - INTERVAL '6 days'),
    ('00000000-0000-0000-0000-000000000202'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', 'demo-sync-20260322', 'incorrect_fee', 'medium', 74.15::numeric, 'USD', 0.91::numeric, jsonb_build_object('scenario', 'ready_to_file'), 'pending', NOW() - INTERVAL '6 days', NOW() - INTERVAL '5 days'),
    ('00000000-0000-0000-0000-000000000203'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', 'demo-sync-20260322', 'overcharge', 'high', 162.75::numeric, 'USD', 0.88::numeric, jsonb_build_object('scenario', 'filed_waiting'), 'disputed', NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'),
    ('00000000-0000-0000-0000-000000000204'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', 'demo-sync-20260322', 'damaged_stock', 'high', 93.20::numeric, 'USD', 0.77::numeric, jsonb_build_object('scenario', 'rejected'), 'reviewed', NOW() - INTERVAL '9 days', NOW() - INTERVAL '3 days'),
    ('00000000-0000-0000-0000-000000000205'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', 'demo-sync-20260322', 'duplicate_charge', 'medium', 145.90::numeric, 'USD', 0.86::numeric, jsonb_build_object('scenario', 'approved_pending_payout'), 'resolved', NOW() - INTERVAL '8 days', NOW() - INTERVAL '2 days'),
    ('00000000-0000-0000-0000-000000000206'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', 'demo-sync-20260322', 'incorrect_fee', 'medium', 112.75::numeric, 'USD', 0.94::numeric, jsonb_build_object('scenario', 'recovered_billing_pending'), 'resolved', NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day'),
    ('00000000-0000-0000-0000-000000000207'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', 'demo-sync-20260322', 'overcharge', 'high', 189.20::numeric, 'USD', 0.97::numeric, jsonb_build_object('scenario', 'billed_complete'), 'resolved', NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 hours')
) AS seed_rows (
  id,
  store_id,
  seller_id,
  sync_id,
  anomaly_type,
  severity,
  estimated_value,
  currency,
  confidence_score,
  evidence,
  status,
  created_at,
  updated_at
)
CROSS JOIN demo_tenant
ON CONFLICT (id) DO NOTHING;

WITH demo_tenant AS (
  SELECT id
  FROM tenants
  WHERE slug = 'demo-workspace'
)
INSERT INTO dispute_cases (
  id,
  tenant_id,
  store_id,
  seller_id,
  detection_result_id,
  case_number,
  status,
  claim_amount,
  currency,
  case_type,
  provider,
  filing_status,
  recovery_status,
  billing_status,
  evidence_attachments,
  provider_case_id,
  expected_payout_date,
  actual_payout_amount,
  created_at,
  updated_at
)
SELECT * FROM (
  VALUES
    ('00000000-0000-0000-0000-000000000301'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', '00000000-0000-0000-0000-000000000201'::uuid, 'DMO-CASE-1001', 'pending', 128.40::numeric, 'USD', 'amazon_fba', 'amazon', 'pending', 'pending', 'pending', '{}'::jsonb, 'AMZ-DEMO-1001', NOW() + INTERVAL '14 days', NULL::numeric, NOW() - INTERVAL '7 days', NOW() - INTERVAL '6 days'),
    ('00000000-0000-0000-0000-000000000302'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', '00000000-0000-0000-0000-000000000202'::uuid, 'DMO-CASE-1002', 'pending', 74.15::numeric, 'USD', 'amazon_fba', 'amazon', 'pending', 'pending', 'pending', '{}'::jsonb, 'AMZ-DEMO-1002', NOW() + INTERVAL '12 days', NULL::numeric, NOW() - INTERVAL '6 days', NOW() - INTERVAL '5 days'),
    ('00000000-0000-0000-0000-000000000303'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', '00000000-0000-0000-0000-000000000203'::uuid, 'DMO-CASE-1003', 'submitted', 162.75::numeric, 'USD', 'amazon_fba', 'amazon', 'filed', 'pending', 'pending', '{}'::jsonb, 'AMZ-DEMO-1003', NOW() + INTERVAL '9 days', NULL::numeric, NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'),
    ('00000000-0000-0000-0000-000000000304'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', '00000000-0000-0000-0000-000000000204'::uuid, 'DMO-CASE-1004', 'rejected', 93.20::numeric, 'USD', 'amazon_fba', 'amazon', 'failed', 'pending', 'pending', jsonb_build_object('rejection_category', 'insufficient_evidence', 'raw_reason_text', 'Invoice date did not match the reimbursement window.'), 'AMZ-DEMO-1004', NOW() + INTERVAL '7 days', NULL::numeric, NOW() - INTERVAL '9 days', NOW() - INTERVAL '3 days'),
    ('00000000-0000-0000-0000-000000000305'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', '00000000-0000-0000-0000-000000000205'::uuid, 'DMO-CASE-1005', 'approved', 145.90::numeric, 'USD', 'amazon_fba', 'amazon', 'filed', 'pending', 'pending', '{}'::jsonb, 'AMZ-DEMO-1005', NOW() + INTERVAL '5 days', NULL::numeric, NOW() - INTERVAL '8 days', NOW() - INTERVAL '2 days'),
    ('00000000-0000-0000-0000-000000000306'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', '00000000-0000-0000-0000-000000000206'::uuid, 'DMO-CASE-1006', 'approved', 112.75::numeric, 'USD', 'amazon_fba', 'amazon', 'filed', 'reconciled', 'pending', '{}'::jsonb, 'AMZ-DEMO-1006', NOW() - INTERVAL '1 day', 112.75::numeric, NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day'),
    ('00000000-0000-0000-0000-000000000307'::uuid, '00000000-0000-0000-0000-0000000000d1'::uuid, 'DEMO-SELLER-001', '00000000-0000-0000-0000-000000000207'::uuid, 'DMO-CASE-1007', 'approved', 189.20::numeric, 'USD', 'amazon_fba', 'amazon', 'filed', 'reconciled', 'credited', '{}'::jsonb, 'AMZ-DEMO-1007', NOW() - INTERVAL '2 days', 189.20::numeric, NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 hours')
) AS seed_rows (
  id,
  store_id,
  seller_id,
  detection_result_id,
  case_number,
  status,
  claim_amount,
  currency,
  case_type,
  provider,
  filing_status,
  recovery_status,
  billing_status,
  evidence_attachments,
  provider_case_id,
  expected_payout_date,
  actual_payout_amount,
  created_at,
  updated_at
)
CROSS JOIN demo_tenant
ON CONFLICT (id) DO NOTHING;

WITH demo_tenant AS (
  SELECT id
  FROM tenants
  WHERE slug = 'demo-workspace'
)
INSERT INTO evidence_documents (
  id,
  tenant_id,
  seller_id,
  doc_type,
  supplier_name,
  invoice_number,
  document_date,
  currency,
  total_amount,
  file_url,
  raw_text,
  extracted,
  created_at,
  updated_at
)
SELECT * FROM (
  VALUES
    ('00000000-0000-0000-0000-000000000401'::uuid, 'DEMO-SELLER-001', 'invoice', 'Demo Logistics Co', 'INV-DEMO-1002', NOW() - INTERVAL '11 days', 'USD', 74.15::numeric, 'demo://invoice/1002', 'Demo invoice for reimbursement support.', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('sku', 'DEMO-SKU-02', 'asin', 'B0DEMO0002', 'quantity', 1))), NOW() - INTERVAL '11 days', NOW() - INTERVAL '11 days'),
    ('00000000-0000-0000-0000-000000000402'::uuid, 'DEMO-SELLER-001', 'shipping', 'Demo Carrier', 'SHIP-DEMO-1003', NOW() - INTERVAL '10 days', 'USD', 162.75::numeric, 'demo://shipping/1003', 'Proof of shipment and handling.', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('sku', 'DEMO-SKU-03', 'asin', 'B0DEMO0003', 'quantity', 2))), NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
    ('00000000-0000-0000-0000-000000000403'::uuid, 'DEMO-SELLER-001', 'invoice', 'Demo Vendor', 'INV-DEMO-1005', NOW() - INTERVAL '9 days', 'USD', 145.90::numeric, 'demo://invoice/1005', 'Approved case invoice support.', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('sku', 'DEMO-SKU-05', 'asin', 'B0DEMO0005', 'quantity', 3))), NOW() - INTERVAL '9 days', NOW() - INTERVAL '9 days'),
    ('00000000-0000-0000-0000-000000000404'::uuid, 'DEMO-SELLER-001', 'invoice', 'Demo Vendor', 'INV-DEMO-1006', NOW() - INTERVAL '8 days', 'USD', 112.75::numeric, 'demo://invoice/1006', 'Recovered case invoice support.', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('sku', 'DEMO-SKU-06', 'asin', 'B0DEMO0006', 'quantity', 1))), NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
    ('00000000-0000-0000-0000-000000000405'::uuid, 'DEMO-SELLER-001', 'invoice', 'Demo Vendor', 'INV-DEMO-1007', NOW() - INTERVAL '13 days', 'USD', 189.20::numeric, 'demo://invoice/1007', 'Billed recovery support.', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('sku', 'DEMO-SKU-07', 'asin', 'B0DEMO0007', 'quantity', 2))), NOW() - INTERVAL '13 days', NOW() - INTERVAL '13 days')
) AS seed_rows (
  id,
  seller_id,
  doc_type,
  supplier_name,
  invoice_number,
  document_date,
  currency,
  total_amount,
  file_url,
  raw_text,
  extracted,
  created_at,
  updated_at
)
CROSS JOIN demo_tenant
ON CONFLICT (id) DO NOTHING;

WITH demo_tenant AS (
  SELECT id
  FROM tenants
  WHERE slug = 'demo-workspace'
)
INSERT INTO dispute_evidence_links (
  dispute_case_id,
  evidence_document_id,
  tenant_id,
  relevance_score,
  matched_context
)
SELECT * FROM (
  VALUES
    ('00000000-0000-0000-0000-000000000302'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 0.94::numeric, jsonb_build_object('match', 'ready_to_file')),
    ('00000000-0000-0000-0000-000000000303'::uuid, '00000000-0000-0000-0000-000000000402'::uuid, 0.91::numeric, jsonb_build_object('match', 'submitted')),
    ('00000000-0000-0000-0000-000000000305'::uuid, '00000000-0000-0000-0000-000000000403'::uuid, 0.89::numeric, jsonb_build_object('match', 'approved_pending_payout')),
    ('00000000-0000-0000-0000-000000000306'::uuid, '00000000-0000-0000-0000-000000000404'::uuid, 0.97::numeric, jsonb_build_object('match', 'recovered')),
    ('00000000-0000-0000-0000-000000000307'::uuid, '00000000-0000-0000-0000-000000000405'::uuid, 0.98::numeric, jsonb_build_object('match', 'billed'))
) AS seed_rows (
  dispute_case_id,
  evidence_document_id,
  relevance_score,
  matched_context
)
CROSS JOIN demo_tenant
ON CONFLICT DO NOTHING;

WITH demo_tenant AS (
  SELECT id
  FROM tenants
  WHERE slug = 'demo-workspace'
)
INSERT INTO billing_transactions (
  id,
  dispute_id,
  tenant_id,
  user_id,
  amount_recovered_cents,
  platform_fee_cents,
  seller_payout_cents,
  currency,
  billing_status,
  idempotency_key,
  metadata,
  created_at,
  updated_at
)
SELECT * FROM (
  VALUES
    ('00000000-0000-0000-0000-000000000501'::uuid, '00000000-0000-0000-0000-000000000307'::uuid, 'demo-workspace', 18920, 3784, 15136, 'usd', 'credited', 'demo-billing-1007', jsonb_build_object('demo_workspace', true, 'case_number', 'DMO-CASE-1007'), NOW() - INTERVAL '12 hours', NOW() - INTERVAL '12 hours')
) AS seed_rows (
  id,
  dispute_id,
  user_id,
  amount_recovered_cents,
  platform_fee_cents,
  seller_payout_cents,
  currency,
  billing_status,
  idempotency_key,
  metadata,
  created_at,
  updated_at
)
CROSS JOIN demo_tenant
ON CONFLICT (id) DO NOTHING;
