-- Migration: Ensure parser_jobs has all required columns
-- Fixes missing column errors for parser_type, started_at, etc.

DO $$ 
BEGIN
  -- Add parser_type if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'parser_type') THEN
    ALTER TABLE parser_jobs ADD COLUMN parser_type TEXT NOT NULL DEFAULT 'pdf';
    CREATE INDEX IF NOT EXISTS idx_parser_jobs_parser_type ON parser_jobs(parser_type);
  END IF;

  -- Add started_at if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'started_at') THEN
    ALTER TABLE parser_jobs ADD COLUMN started_at TIMESTAMPTZ;
  END IF;

   -- Add completed_at if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'completed_at') THEN
    ALTER TABLE parser_jobs ADD COLUMN completed_at TIMESTAMPTZ;
  END IF;

  -- Add status if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parser_jobs' AND column_name = 'status') THEN
    ALTER TABLE parser_jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
    CREATE INDEX IF NOT EXISTS idx_parser_jobs_status ON parser_jobs(status);
  END IF;
END $$;
