-- Migration: Add link_type column to dispute_evidence_links
-- This column is required by Agent 6 (Evidence Matching) to track the type of link

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

-- Add index for faster queries by link_type
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_links_link_type 
ON dispute_evidence_links(link_type);

-- Comment explaining link_type values
COMMENT ON COLUMN dispute_evidence_links.link_type IS 
  'Type of evidence link: auto_matched, manual, smart_prompt, rejected';
