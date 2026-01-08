-- Create user_notes table for persistent note-taking
CREATE TABLE IF NOT EXISTS public.user_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL, -- Using TEXT to support both UUIDs and demo-user IDs
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- index for user_id to speed up lookups
CREATE INDEX IF NOT EXISTS idx_user_notes_user_id ON public.user_notes(user_id);

-- Enable Row Level Security
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

-- Allow users to see only their own notes
CREATE POLICY "Users can view their own notes" 
    ON public.user_notes FOR SELECT 
    USING (user_id = auth.uid()::text OR user_id = 'demo-user');

-- Allow users to insert their own notes
CREATE POLICY "Users can insert their own notes" 
    ON public.user_notes FOR INSERT 
    WITH CHECK (user_id = auth.uid()::text OR user_id = 'demo-user');

-- Allow users to delete their own notes
CREATE POLICY "Users can delete their own notes" 
    ON public.user_notes FOR DELETE 
    USING (user_id = auth.uid()::text OR user_id = 'demo-user');

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_notes_updated_at
    BEFORE UPDATE ON public.user_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
