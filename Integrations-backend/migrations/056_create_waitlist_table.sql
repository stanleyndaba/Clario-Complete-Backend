-- Migration: Create Waitlist Table
-- Description: Stores signups for the platform waitlist

CREATE TABLE IF NOT EXISTS public.waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    company_name TEXT,
    monthly_volume TEXT,
    referral_source TEXT,
    status TEXT DEFAULT 'pending', -- pending, invited, joined
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for email lookups
CREATE INDEX IF NOT EXISTS waitlist_email_idx ON public.waitlist(email);

-- Enable Row Level Security
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Allow public to insert into waitlist (for the landing page form)
CREATE POLICY "Allow public insert into waitlist" ON public.waitlist
    FOR INSERT WITH CHECK (true);

-- Allow admins to view/manage waitlist
-- Assuming we use service role or a specific admin check
CREATE POLICY "Allow service role full access to waitlist" ON public.waitlist
    FOR ALL USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_waitlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function
CREATE TRIGGER update_waitlist_updated_at_trigger
    BEFORE UPDATE ON public.waitlist
    FOR EACH ROW
    EXECUTE FUNCTION update_waitlist_updated_at();
