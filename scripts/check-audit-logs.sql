-- SQL queries to check audit logs
-- Run these in Supabase SQL Editor or via psql

-- 1. Verify audit_logs table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'audit_logs';

-- 2. Check table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;

-- 3. Check indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'audit_logs';

-- 4. Count total audit log entries
SELECT COUNT(*) as total_entries FROM audit_logs;

-- 5. Get recent audit events (last 20)
SELECT 
    id,
    event_type,
    user_id,
    provider,
    ip_address,
    severity,
    created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 20;

-- 6. Count events by type
SELECT 
    event_type,
    COUNT(*) as count,
    MAX(created_at) as last_occurrence
FROM audit_logs
GROUP BY event_type
ORDER BY count DESC;

-- 7. Check token events
SELECT 
    id,
    event_type,
    user_id,
    provider,
    metadata->>'tokenId' AS token_id,
    metadata->>'reason' AS reason,
    severity,
    created_at
FROM audit_logs
WHERE event_type LIKE '%token%'
   OR event_type LIKE '%refresh%'
ORDER BY created_at DESC
LIMIT 50;

-- 8. Check authentication events
SELECT 
    id,
    event_type,
    user_id,
    ip_address,
    provider,
    severity,
    created_at
FROM audit_logs
WHERE event_type LIKE '%auth%'
ORDER BY created_at DESC
LIMIT 50;

-- 9. Check security events (high/critical severity)
SELECT 
    id,
    event_type,
    user_id,
    ip_address,
    metadata,
    severity,
    created_at
FROM audit_logs
WHERE event_type LIKE '%security%'
   OR severity IN ('high', 'critical')
ORDER BY created_at DESC
LIMIT 50;

-- 10. Check for multiple failed refresh attempts (alert condition)
-- This identifies potential security issues
SELECT 
    ip_address,
    COUNT(*) as failed_attempts,
    MAX(created_at) as last_attempt,
    ARRAY_AGG(DISTINCT user_id) as affected_users
FROM audit_logs
WHERE event_type = 'token_token_refresh_failed'
  AND created_at > NOW() - INTERVAL '15 minutes'
GROUP BY ip_address
HAVING COUNT(*) >= 5
ORDER BY failed_attempts DESC;

-- 11. Check token rotation events
SELECT 
    event_type,
    user_id,
    provider,
    metadata->>'tokenId' AS token_id,
    created_at
FROM audit_logs
WHERE event_type = 'token_token_rotated'
ORDER BY created_at DESC
LIMIT 20;

-- 12. Events by severity
SELECT 
    severity,
    COUNT(*) as count,
    MAX(created_at) as last_occurrence
FROM audit_logs
GROUP BY severity
ORDER BY 
    CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
    END;

-- 13. Recent events by provider
SELECT 
    provider,
    event_type,
    COUNT(*) as count
FROM audit_logs
WHERE provider IS NOT NULL
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY provider, event_type
ORDER BY provider, count DESC;

-- 14. Check for suspicious activity (multiple events from same IP)
SELECT 
    ip_address,
    COUNT(DISTINCT event_type) as unique_event_types,
    COUNT(*) as total_events,
    MAX(created_at) as last_event
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND ip_address IS NOT NULL
GROUP BY ip_address
HAVING COUNT(*) > 10
ORDER BY total_events DESC;

