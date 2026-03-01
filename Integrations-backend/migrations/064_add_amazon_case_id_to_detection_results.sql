-- Migration: 064_add_amazon_case_id_to_detection_results
-- Adds amazon_case_id column and relaxes the status CHECK constraint 
-- to support the "Link Amazon Case ID" and "Mark as False Positive" features

-- Step 1: Add amazon_case_id column to detection_results
ALTER TABLE detection_results ADD COLUMN IF NOT EXISTS amazon_case_id TEXT;

-- Step 2: Drop the old restrictive CHECK constraint on status
-- The original constraint only allowed: 'pending', 'reviewed', 'disputed', 'resolved'
-- We need to also allow: 'found', 'unsubmitted', 'filed', 'converted', 'false_positive', 'detected'
ALTER TABLE detection_results DROP CONSTRAINT IF EXISTS detection_results_status_check;

-- Step 3: Add a new, wider CHECK constraint that covers all workflow states
ALTER TABLE detection_results ADD CONSTRAINT detection_results_status_check
  CHECK (status IN (
    'pending',       -- Awaiting review / submitted to Amazon
    'detected',      -- Freshly detected by agent
    'found',         -- Confirmed discrepancy
    'unsubmitted',   -- Ready but not yet filed
    'filed',         -- Claim filed with Amazon
    'reviewed',      -- Admin reviewed
    'disputed',      -- Under dispute
    'resolved',      -- Fully resolved
    'converted',     -- Converted to formal claim
    'false_positive' -- Marked as false positive by admin
  ));

-- Step 4: Index for fast lookups by case ID
CREATE INDEX IF NOT EXISTS idx_detection_results_amazon_case_id ON detection_results(amazon_case_id);

-- Step 5: Comment for documentation
COMMENT ON COLUMN detection_results.amazon_case_id IS 'Amazon Seller Support Case ID linked by admin after manual claim submission';
