-- Migration: Add Notifications Worker Support (Agent 10)
-- Creates notifications table if it doesn't exist and adds missing event types

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create notifications table if it doesn't exist
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',
        'sent',
        'delivered',
        'read',
        'failed',
        'expired'
    )),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN (
        'low',
        'normal',
        'high',
        'urgent'
    )),
    channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN (
        'in_app',
        'email',
        'both'
    )),
    payload JSONB DEFAULT '{}'::jsonb,
    read_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update notifications table to include new event types
DO $$ 
BEGIN
  -- Drop existing CHECK constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'notifications_type_check' 
    AND table_name = 'notifications'
  ) THEN
    ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
  END IF;

  -- Add new CHECK constraint with all event types
  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
    CHECK (type IN (
      'claim_detected',
      'evidence_found',
      'case_filed',
      'refund_approved',
      'funds_deposited',
      'integration_completed',
      'payment_processed',
      'sync_completed',
      'discrepancy_found',
      'system_alert',
      'user_action_required'
    ));
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(channel);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type ON notifications(user_id, type);
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Add index for pending notifications (for worker queries)
CREATE INDEX IF NOT EXISTS idx_notifications_status_created 
ON notifications(status, created_at) 
WHERE status = 'pending';

-- Enable Row Level Security (RLS)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (drop existing if they exist, then recreate)
DO $$
BEGIN
  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Users can view their own notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can insert their own notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can delete their own notifications" ON notifications;
END $$;

-- Create RLS policies with explicit type casting
CREATE POLICY "Users can view their own notifications" ON notifications
    FOR SELECT USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can insert their own notifications" ON notifications
    FOR INSERT WITH CHECK (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can update their own notifications" ON notifications
    FOR UPDATE USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

CREATE POLICY "Users can delete their own notifications" ON notifications
    FOR DELETE USING (CAST(auth.uid() AS TEXT) = CAST(user_id AS TEXT));

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_update_notifications_updated_at ON notifications;
CREATE TRIGGER trigger_update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_notifications_updated_at();

-- Add comments
COMMENT ON TABLE notifications IS 'Stores user notifications for the notification system';
COMMENT ON COLUMN notifications.id IS 'Unique identifier for the notification';
COMMENT ON COLUMN notifications.user_id IS 'ID of the user who owns this notification';
COMMENT ON COLUMN notifications.type IS 'Type of notification: claim_detected, evidence_found, case_filed, refund_approved, funds_deposited, integration_completed, payment_processed, sync_completed, discrepancy_found, system_alert, user_action_required';
COMMENT ON COLUMN notifications.title IS 'Notification title';
COMMENT ON COLUMN notifications.message IS 'Notification message content';
COMMENT ON COLUMN notifications.status IS 'Current status of the notification';
COMMENT ON COLUMN notifications.priority IS 'Priority level of the notification';
COMMENT ON COLUMN notifications.channel IS 'Delivery channel(s) for the notification';
COMMENT ON COLUMN notifications.payload IS 'Additional metadata for the notification';
COMMENT ON COLUMN notifications.read_at IS 'Timestamp when notification was read';
COMMENT ON COLUMN notifications.delivered_at IS 'Timestamp when notification was delivered';
COMMENT ON COLUMN notifications.expires_at IS 'Timestamp when notification expires';
COMMENT ON COLUMN notifications.created_at IS 'Timestamp when notification was created';
COMMENT ON COLUMN notifications.updated_at IS 'Timestamp when notification was last updated';

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;

-- Verify the update
SELECT 
    constraint_name,
    check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'notifications_type_check';

