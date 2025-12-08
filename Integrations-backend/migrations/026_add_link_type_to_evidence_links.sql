-- Migration: Add missing columns to dispute_evidence_links
-- Required by Agent 6 (Evidence Matching)

-- Add link_type column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_evidence_links' AND column_name = 'link_type'
  ) THEN
    ALTER TABLE dispute_evidence_links
    ADD COLUMN link_type VARCHAR(50) DEFAULT 'auto_matched';
  END IF;
END
$$;

-- Add confidence_score column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'dispute_evidence_links' AND column_name = 'confidence_score'
  ) THEN
    ALTER TABLE dispute_evidence_links
    ADD COLUMN confidence_score DECIMAL(5,4);
  END IF;
END
$$;

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_link_type 
ON dispute_evidence_links(link_type);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_confidence 
ON dispute_evidence_links(confidence_score);

-- Comments
COMMENT ON COLUMN dispute_evidence_links.link_type IS 
  'Type of evidence link: auto_matched, manual, smart_prompt, rejected';
COMMENT ON COLUMN dispute_evidence_links.confidence_score IS 
  'Confidence score of the match (0.0000 to 1.0000)';
