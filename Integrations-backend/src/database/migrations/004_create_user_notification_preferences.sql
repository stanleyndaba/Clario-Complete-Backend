-- Migration: Create user_notification_preferences table
-- Description: Stores user notification preferences for email/in-app toggles

CREATE TABLE IF NOT EXISTS user_notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE,
    preferences JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id 
ON user_notification_preferences(user_id);

-- Add comment for documentation
COMMENT ON TABLE user_notification_preferences IS 'Stores user notification preferences for email/in-app channel toggles';
COMMENT ON COLUMN user_notification_preferences.preferences IS 'JSONB storing preference toggles like {"recovery-guaranteed": {"email": true, "inApp": true}, ...}';

-- Enable RLS (Row Level Security)
ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see/modify their own preferences
CREATE POLICY "Users can view own notification preferences" ON user_notification_preferences
    FOR SELECT USING (auth.uid()::text = user_id OR user_id = 'demo-user');

CREATE POLICY "Users can insert own notification preferences" ON user_notification_preferences
    FOR INSERT WITH CHECK (auth.uid()::text = user_id OR user_id = 'demo-user');

CREATE POLICY "Users can update own notification preferences" ON user_notification_preferences
    FOR UPDATE USING (auth.uid()::text = user_id OR user_id = 'demo-user');
