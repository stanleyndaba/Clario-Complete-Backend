-- Margin Audit Certification Foundation
-- SP-API settlements are canonical only when tenant, user, store, and provider identity agree.
-- This migration intentionally fails if production contains duplicate rows under the
-- strengthened key; operators must reconcile ambiguous data rather than collapse it.

ALTER TABLE IF EXISTS settlements
  ADD COLUMN IF NOT EXISTS store_id TEXT;

ALTER TABLE IF EXISTS settlements
  DROP CONSTRAINT IF EXISTS settlements_tenant_user_settlement_type_unique;

ALTER TABLE IF EXISTS settlements
  ADD CONSTRAINT settlements_tenant_user_store_settlement_type_unique
  UNIQUE (tenant_id, user_id, store_id, settlement_id, transaction_type);
