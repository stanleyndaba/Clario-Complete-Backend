-- Add 'onedrive' to evidence_provider enum if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'evidence_provider' AND e.enumlabel = 'onedrive'
    ) THEN
        ALTER TYPE evidence_provider ADD VALUE 'onedrive';
    END IF;
END $$;

