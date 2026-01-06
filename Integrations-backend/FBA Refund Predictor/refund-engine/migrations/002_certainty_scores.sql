-- Certainty Engine MVP - certainty_scores table migration
-- Stores refund likelihood scores and risk assessments for flagged claims

CREATE TABLE IF NOT EXISTS "certainty_scores" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL,
  refund_probability FLOAT NOT NULL CHECK (refund_probability >= 0.0 AND refund_probability <= 1.0),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Foreign key to claims table
  CONSTRAINT fk_certainty_scores_claim_id FOREIGN KEY (claim_id) REFERENCES "Claim"(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "idx_certainty_scores_claim_id" ON "certainty_scores"(claim_id);
CREATE INDEX IF NOT EXISTS "idx_certainty_scores_risk_level" ON "certainty_scores"(risk_level);
CREATE INDEX IF NOT EXISTS "idx_certainty_scores_created_at" ON "certainty_scores"(created_at);

-- RLS Policies for security
ALTER TABLE "certainty_scores" ENABLE ROW LEVEL SECURITY;

-- Allow insert for authenticated users
CREATE POLICY "certainty_scores_insert_policy" ON "certainty_scores"
  FOR INSERT WITH CHECK (true);

-- Allow select for authenticated users
CREATE POLICY "certainty_scores_select_policy" ON "certainty_scores"
  FOR SELECT USING (true);

-- Deny updates and deletes (append-only)
CREATE POLICY "certainty_scores_no_updates" ON "certainty_scores"
  FOR UPDATE USING (false);

CREATE POLICY "certainty_scores_no_deletes" ON "certainty_scores"
  FOR DELETE USING (false);

-- Add comment for documentation
COMMENT ON TABLE "certainty_scores" IS 'Refund likelihood scores and risk assessments for flagged claims';
COMMENT ON COLUMN "certainty_scores".refund_probability IS 'Probability of successful refund (0.0 to 1.0)';
COMMENT ON COLUMN "certainty_scores".risk_level IS 'Risk category: Low (< 0.3), Medium (0.3-0.7), High (> 0.7)';

