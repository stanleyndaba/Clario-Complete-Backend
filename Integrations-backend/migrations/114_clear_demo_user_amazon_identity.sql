-- Migration: Clear demo user Amazon identity from the real user binding table
-- The ACME demo workspace keeps its seeded tenant/store/case data, but the demo
-- user row must not reserve a seller ID that can block live OAuth callbacks.

UPDATE users u
SET
  amazon_seller_id = NULL,
  seller_id = NULL,
  updated_at = NOW()
FROM tenants t
WHERE u.tenant_id = t.id
  AND (
    t.slug = 'demo-workspace'
    OR t.metadata->>'is_demo_workspace' = 'true'
    OR lower(coalesce(u.email, '')) LIKE '%demo%'
  )
  AND (
    u.amazon_seller_id IS NOT NULL
    OR u.seller_id IS NOT NULL
  );
