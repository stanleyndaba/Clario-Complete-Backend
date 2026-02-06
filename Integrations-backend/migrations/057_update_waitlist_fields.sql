-- Migration: Update Waitlist Fields
-- Description: Adds new fields for lead categorization and sorting

ALTER TABLE public.waitlist 
ADD COLUMN IF NOT EXISTS user_type TEXT,
ADD COLUMN IF NOT EXISTS brand_count TEXT,
ADD COLUMN IF NOT EXISTS annual_revenue TEXT,
ADD COLUMN IF NOT EXISTS contact_handle TEXT,
ADD COLUMN IF NOT EXISTS primary_goal TEXT;

-- Add a comment for documentation
COMMENT ON COLUMN public.waitlist.user_type IS 'Type of user: Brand Owner, Agency, Investor, etc.';
COMMENT ON COLUMN public.waitlist.brand_count IS 'Number of brands managed (typically for agencies)';
COMMENT ON COLUMN public.waitlist.annual_revenue IS 'Estimated annual revenue band';
COMMENT ON COLUMN public.waitlist.contact_handle IS 'WhatsApp, Telegram, or other social handle';
COMMENT ON COLUMN public.waitlist.primary_goal IS 'Primary goal: Recover profit, Audit, Automate, etc.';
