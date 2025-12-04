-- Migration: Ensure parser_jobs has user_id column
-- Fixes "column user_id of relation parser_jobs does not exist" error

DO $$ 
BEGIN
  -- Add user_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'user_id') THEN
    ALTER TABLE parser_jobs ADD COLUMN user_id UUID;
    
    -- Add index for performance
    CREATE INDEX IF NOT EXISTS idx_parser_jobs_user_id ON parser_jobs(user_id);
  END IF;
END $$;
