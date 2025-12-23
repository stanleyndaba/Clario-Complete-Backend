-- Migration: Add missing columns to claims table for detection-to-claims flow
-- The current Supabase claims table is missing columns expected by the code

-- First, check if columns exist and add if missing
DO $$
BEGIN
    -- Add user_id if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'user_id') THEN
        ALTER TABLE claims ADD COLUMN user_id UUID;
        CREATE INDEX IF NOT EXISTS idx_claims_user_id ON claims(user_id);
    END IF;
    
    -- Add claim_type if not exists (with default)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'claim_type') THEN
        ALTER TABLE claims ADD COLUMN claim_type TEXT DEFAULT 'reimbursement';
    END IF;
    
    -- Add provider if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'provider') THEN
        ALTER TABLE claims ADD COLUMN provider TEXT DEFAULT 'amazon';
    END IF;
    
    -- Add reference_id if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'reference_id') THEN
        ALTER TABLE claims ADD COLUMN reference_id TEXT;
    END IF;
    
    -- Add amount if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'amount') THEN
        ALTER TABLE claims ADD COLUMN amount NUMERIC(12,2) DEFAULT 0;
    END IF;
    
    -- Add currency if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'currency') THEN
        ALTER TABLE claims ADD COLUMN currency TEXT DEFAULT 'USD';
    END IF;
    
    -- Add status if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'status') THEN
        ALTER TABLE claims ADD COLUMN status TEXT DEFAULT 'pending';
    END IF;
    
    -- Add reason if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'reason') THEN
        ALTER TABLE claims ADD COLUMN reason TEXT;
    END IF;
    
    -- Add evidence if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'evidence') THEN
        ALTER TABLE claims ADD COLUMN evidence TEXT[];
    END IF;
    
    -- Add submitted_at if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'submitted_at') THEN
        ALTER TABLE claims ADD COLUMN submitted_at TIMESTAMPTZ;
    END IF;
    
    -- Add created_at if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'created_at') THEN
        ALTER TABLE claims ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    
    -- Add updated_at if not exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'updated_at') THEN
        ALTER TABLE claims ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

COMMENT ON TABLE claims IS 'Claims created from detection results for frontend visibility';
