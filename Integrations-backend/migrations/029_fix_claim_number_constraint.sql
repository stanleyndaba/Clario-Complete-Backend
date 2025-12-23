-- Migration: Fix claim_number constraint to allow batch inserts
-- Problem: Unique constraint on claim_number causes failures during batch inserts
-- Solution: Drop the unique index and rely on the ID for uniqueness

-- Drop the unique index on claim_number
DROP INDEX IF EXISTS idx_detection_results_claim_number;

-- Create a non-unique index instead for query performance
CREATE INDEX IF NOT EXISTS idx_detection_results_claim_number_nonunique 
ON detection_results(claim_number);

-- Update the generate function to include a random suffix for uniqueness
CREATE OR REPLACE FUNCTION generate_claim_number(anomaly_type TEXT)
RETURNS TEXT AS $$
DECLARE
    type_prefix TEXT;
    year_month TEXT;
    seq_num INTEGER;
    random_suffix TEXT;
    claim_num TEXT;
BEGIN
    -- Map anomaly type to prefix
    CASE 
        WHEN anomaly_type ILIKE '%lost%' OR anomaly_type ILIKE '%missing%' THEN type_prefix := 'LI';
        WHEN anomaly_type ILIKE '%damaged%' THEN type_prefix := 'DM';
        WHEN anomaly_type ILIKE '%fee%' OR anomaly_type ILIKE '%overcharge%' THEN type_prefix := 'FD';
        WHEN anomaly_type ILIKE '%return%' OR anomaly_type ILIKE '%refund%' THEN type_prefix := 'UR';
        WHEN anomaly_type ILIKE '%storage%' THEN type_prefix := 'ST';
        WHEN anomaly_type ILIKE '%carrier%' THEN type_prefix := 'CC';
        ELSE type_prefix := 'CL';
    END CASE;
    
    -- Get current year-month
    year_month := TO_CHAR(NOW(), 'YYMM');
    
    -- Get next sequence number
    seq_num := nextval('claim_number_seq');
    
    -- Add random suffix to ensure uniqueness
    random_suffix := SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 4);
    
    -- Format claim number with random suffix
    claim_num := type_prefix || '-' || year_month || '-' || seq_num::TEXT || '-' || random_suffix;
    
    RETURN claim_num;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN detection_results.claim_number IS 'Human-readable claim ID - format TYPE-YYMM-SEQ-RAND';
