-- Migration: Fix tokens table for all OAuth providers
-- Problem: CHECK constraint only allows ('amazon', 'gmail', 'stripe')
--          but code saves tokens for 6 providers: amazon, gmail, stripe, outlook, gdrive, dropbox
-- Also: tenant_id and store_id columns are missing but expected by the backend

-- 1. Drop the restrictive CHECK constraint
--    (constraint name varies — try both common patterns)
ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_provider_check;
ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_check;

-- Remove any inline CHECK on the provider column (Supabase may name it differently)
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
    WHERE con.conrelid = 'tokens'::regclass
      AND con.contype = 'c'
      AND att.attname = 'provider'
  LOOP
    EXECUTE format('ALTER TABLE tokens DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

-- 2. Add missing columns
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS store_id text;

-- 3. Add index on tenant_id for multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_tokens_tenant ON tokens(tenant_id) WHERE tenant_id IS NOT NULL;
