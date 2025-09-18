-- Integration: Certainty Engine with Evidence & Value Engine
-- Adds certainty_score_id to Claim table and enhances TransactionJournal

-- Add certainty_score_id to Claim table
ALTER TABLE "Claim" ADD COLUMN IF NOT EXISTS "certainty_score_id" UUID;

-- Add foreign key constraint to certainty_scores table
ALTER TABLE "Claim" ADD CONSTRAINT IF NOT EXISTS "fk_claim_certainty_score_id" 
  FOREIGN KEY ("certainty_score_id") REFERENCES "certainty_scores"(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS "idx_claim_certainty_score_id" ON "Claim"("certainty_score_id");

-- Add comment for documentation
COMMENT ON COLUMN "Claim"."certainty_score_id" IS 'Reference to certainty score for full traceability';

-- Update existing claims to have NULL certainty_score_id
UPDATE "Claim" SET "certainty_score_id" = NULL WHERE "certainty_score_id" IS NOT NULL;

-- Verify the changes
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'Claim' 
  AND column_name IN ('proof_bundle_id', 'certainty_score_id');

-- Show the updated table structure
\d "Claim"









