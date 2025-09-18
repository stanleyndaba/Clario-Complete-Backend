-- Migration: Add Notifications Tables
-- This migration adds the necessary tables for the notifications service

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'push', 'inapp', 'slack')),
  template_id TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'delivered', 'opened', 'deleted')),
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create user_notification_preferences table
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'push', 'inapp', 'slack')),
  type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, channel, type)
);

-- Create inapp_notifications table
CREATE TABLE IF NOT EXISTS inapp_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  actions JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMP WITH TIME ZONE,
  category TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_type ON user_notification_preferences(type);

CREATE INDEX IF NOT EXISTS idx_inapp_notifications_user_id ON inapp_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_inapp_notifications_read ON inapp_notifications(read);
CREATE INDEX IF NOT EXISTS idx_inapp_notifications_created_at ON inapp_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_inapp_notifications_expires_at ON inapp_notifications(expires_at);

-- Create RLS policies for multi-tenant security
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE inapp_notifications ENABLE ROW LEVEL SECURITY;

-- RLS policies for notifications table
CREATE POLICY "Users can view their own notifications" ON notifications
  FOR SELECT USING (user_id = current_setting('app.current_user_id', true)::text);

CREATE POLICY "Users can update their own notifications" ON notifications
  FOR UPDATE USING (user_id = current_setting('app.current_user_id', true)::text);

CREATE POLICY "Users can insert their own notifications" ON notifications
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_user_id', true)::text);

-- RLS policies for user_notification_preferences table
CREATE POLICY "Users can view their own preferences" ON user_notification_preferences
  FOR SELECT USING (user_id = current_setting('app.current_user_id', true)::text);

CREATE POLICY "Users can update their own preferences" ON user_notification_preferences
  FOR UPDATE USING (user_id = current_setting('app.current_user_id', true)::text);

CREATE POLICY "Users can insert their own preferences" ON user_notification_preferences
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_user_id', true)::text);

-- RLS policies for inapp_notifications table
CREATE POLICY "Users can view their own in-app notifications" ON inapp_notifications
  FOR SELECT USING (user_id = current_setting('app.current_user_id', true)::text);

CREATE POLICY "Users can update their own in-app notifications" ON inapp_notifications
  FOR UPDATE USING (user_id = current_setting('app.current_user_id', true)::text);

CREATE POLICY "Users can insert their own in-app notifications" ON inapp_notifications
  FOR INSERT WITH CHECK (user_id = current_setting('app.current_user_id', true)::text);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_notifications_updated_at 
  BEFORE UPDATE ON notifications 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_notification_preferences_updated_at 
  BEFORE UPDATE ON user_notification_preferences 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inapp_notifications_updated_at 
  BEFORE UPDATE ON inapp_notifications 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); 