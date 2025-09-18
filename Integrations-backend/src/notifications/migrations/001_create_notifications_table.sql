-- Migration: Create Notifications Table
-- This migration creates the notifications table for the notification system
-- Run this in your Supabase SQL editor or via your migration tool

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN (
        'claim_detected',
        'integration_completed', 
        'payment_processed',
        'sync_completed',
        'discrepancy_found',
        'system_alert',
        'user_action_required'
    )),
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

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Users can only see their own notifications
CREATE POLICY "Users can view their own notifications" ON notifications
    FOR SELECT USING (auth.uid()::text = user_id);

-- Users can only insert notifications for themselves
CREATE POLICY "Users can insert their own notifications" ON notifications
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Users can only update their own notifications
CREATE POLICY "Users can update their own notifications" ON notifications
    FOR UPDATE USING (auth.uid()::text = user_id);

-- Users can only delete their own notifications
CREATE POLICY "Users can delete their own notifications" ON notifications
    FOR DELETE USING (auth.uid()::text = user_id);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_notifications_updated_at();

-- Create function to clean up expired notifications
CREATE OR REPLACE FUNCTION cleanup_expired_notifications()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM notifications 
    WHERE expires_at IS NOT NULL AND expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to clean up expired notifications (optional)
-- This requires pg_cron extension to be enabled in Supabase
-- SELECT cron.schedule('cleanup-expired-notifications', '0 2 * * *', 'SELECT cleanup_expired_notifications();');

-- Insert sample data for testing (optional)
INSERT INTO notifications (user_id, type, title, message, priority, channel, payload) VALUES
    ('test-user-1', 'claim_detected', 'New Claim Detected', 'A potential reimbursement claim has been identified for your Amazon account.', 'high', 'both', '{"claim_id": "CLM-001", "amount": 25.50, "source": "amazon"}'),
    ('test-user-1', 'integration_completed', 'Amazon Integration Complete', 'Your Amazon SP-API integration has been successfully completed.', 'normal', 'in_app', '{"integration_type": "amazon", "status": "active"}'),
    ('test-user-2', 'sync_completed', 'Inventory Sync Complete', 'Your inventory synchronization has completed successfully.', 'normal', 'in_app', '{"items_synced": 150, "discrepancies_found": 3}'),
    ('test-user-2', 'discrepancy_found', 'Inventory Discrepancy Detected', '3 inventory discrepancies have been found during sync.', 'high', 'both', '{"discrepancy_count": 3, "severity": "medium"}')
ON CONFLICT DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE notifications IS 'Stores user notifications for the notification system';
COMMENT ON COLUMN notifications.id IS 'Unique identifier for the notification';
COMMENT ON COLUMN notifications.user_id IS 'ID of the user who owns this notification';
COMMENT ON COLUMN notifications.type IS 'Type of notification (claim_detected, integration_completed, etc.)';
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
GRANT USAGE ON SEQUENCE notifications_id_seq TO authenticated;

-- Verify the table was created successfully
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'notifications' 
ORDER BY ordinal_position;

