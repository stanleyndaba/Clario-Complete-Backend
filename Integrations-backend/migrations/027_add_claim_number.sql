-- Migration: Add claim_number column for human-readable claim IDs
-- Format: {TYPE}-{YYMM}-{SEQ} e.g., LI-2412-0001

-- Add the claim_number column
ALTER TABLE detection_results
ADD COLUMN IF NOT EXISTS claim_number VARCHAR(20);

-- Create a unique index for claim_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_detection_results_claim_number 
ON detection_results(claim_number) 
WHERE claim_number IS NOT EXISTS;

-- Create a sequence for claim numbers (per month)
CREATE SEQUENCE IF NOT EXISTS claim_number_seq START 1;

-- Function to generate human-readable claim number
CREATE OR REPLACE FUNCTION generate_claim_number(anomaly_type TEXT)
RETURNS TEXT AS $$
DECLARE
    type_prefix TEXT;
    year_month TEXT;
    seq_num INTEGER;
    claim_num TEXT;
BEGIN
    -- Map anomaly type to prefix
    CASE 
        WHEN anomaly_type ILIKE '%lost%' OR anomaly_type = 'missing_unit' THEN type_prefix := 'LI';
        WHEN anomaly_type ILIKE '%damaged%' OR anomaly_type = 'damaged_stock' THEN type_prefix := 'DM';
        WHEN anomaly_type ILIKE '%fee%' OR anomaly_type = 'incorrect_fee' THEN type_prefix := 'FD';
        WHEN anomaly_type ILIKE '%return%' OR anomaly_type = 'return_not_credited' THEN type_prefix := 'UR';
        WHEN anomaly_type ILIKE '%overcharge%' OR anomaly_type = 'duplicate_charge' THEN type_prefix := 'OC';
        ELSE type_prefix := 'CL';
    END CASE;
    
    -- Get current year-month
    year_month := TO_CHAR(NOW(), 'YYMM');
    
    -- Get next sequence number
    seq_num := nextval('claim_number_seq');
    
    -- Format claim number
    claim_num := type_prefix || '-' || year_month || '-' || LPAD(seq_num::TEXT, 4, '0');
    
    RETURN claim_num;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate claim_number on insert
CREATE OR REPLACE FUNCTION trigger_generate_claim_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.claim_number IS NULL THEN
        NEW.claim_number := generate_claim_number(COALESCE(NEW.anomaly_type, 'unknown'));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trg_generate_claim_number ON detection_results;
CREATE TRIGGER trg_generate_claim_number
BEFORE INSERT ON detection_results
FOR EACH ROW
EXECUTE FUNCTION trigger_generate_claim_number();

-- Backfill existing records with claim numbers
DO $$
DECLARE
    rec RECORD;
    new_claim_num TEXT;
BEGIN
    FOR rec IN 
        SELECT id, anomaly_type 
        FROM detection_results 
        WHERE claim_number IS NULL
        ORDER BY created_at ASC
    LOOP
        new_claim_num := generate_claim_number(COALESCE(rec.anomaly_type, 'unknown'));
        UPDATE detection_results SET claim_number = new_claim_num WHERE id = rec.id;
    END LOOP;
END $$;

-- Add comment
COMMENT ON COLUMN detection_results.claim_number IS 'Human-readable claim ID in format TYPE-YYMM-NNNN';
