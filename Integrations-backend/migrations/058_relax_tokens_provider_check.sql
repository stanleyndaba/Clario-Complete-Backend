-- Migration 058: Relax Tokens Provider Check
-- Created: 2026-02-07
-- Purpose: Remove restrictive provider CHECK constraint to support new integrations (Google Drive, Outlook, Dropbox)

DO $$
BEGIN
    -- Drop the provider CHECK constraint if it exists
    -- Migration 020 created it as: CHECK (provider IN ('amazon', 'gmail', 'stripe'))
    ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_provider_check;
    
    -- Also try common naming patterns if the above fails
    EXECUTE (
        SELECT string_agg('ALTER TABLE tokens DROP CONSTRAINT IF EXISTS ' || quote_ident(conname) || ';', ' ')
        FROM pg_constraint
        WHERE conrelid = 'tokens'::regclass
        AND conname LIKE '%provider%'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not drop tokens provider constraint: %', SQLERRM;
END $$;

-- Add a comment to the table to document the change
COMMENT ON COLUMN tokens.provider IS 'Provider ID (e.g., amazon, gmail, stripe, gdrive, outlook, dropbox)';

-- Log the migration
INSERT INTO audit_logs (tenant_id, actor_type, action, resource_type, metadata)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'system',
    'migration.relax_tokens_provider',
    'database',
    jsonb_build_object('migration', '058_relax_tokens_provider_check', 'timestamp', NOW()::TEXT)
) ON CONFLICT DO NOTHING;
