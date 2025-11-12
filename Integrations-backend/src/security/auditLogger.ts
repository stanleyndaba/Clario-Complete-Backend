/**
 * Audit Logger
 * 
 * Structured logging for security events, authentication, and token operations
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';
import { sanitizeLogData } from './logSanitizer';

export interface AuditLogEntry {
  event_type: string;
  user_id?: string;
  ip_address?: string;
  user_agent?: string;
  provider?: string;
  metadata?: any;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  created_at?: string;
}

/**
 * Log audit event to database and application logs
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    // Sanitize metadata before logging
    const sanitizedMetadata = entry.metadata
      ? sanitizeLogData(entry.metadata)
      : {};

    const auditEntry = {
      event_type: entry.event_type,
      user_id: entry.user_id || null,
      ip_address: entry.ip_address || null,
      user_agent: entry.user_agent || null,
      provider: entry.provider || null,
      metadata: sanitizedMetadata,
      severity: entry.severity || 'low',
      created_at: entry.created_at || new Date().toISOString(),
    };

    // Log to database (Supabase audit_logs table)
    try {
      const { error } = await supabase.from('audit_logs').insert(auditEntry);

      if (error) {
        logger.error('Failed to insert audit log', {
          error: error.message,
          entry: auditEntry,
        });
      }
    } catch (dbError: any) {
      // Database logging failed - log to application logs only
      logger.error('Database audit logging failed', {
        error: dbError.message,
        entry: auditEntry,
      });
    }

    // Also log to application logs with appropriate level
    const logLevel = getLogLevel(entry.severity || 'low');
    logger[logLevel]('Audit event', {
      event_type: entry.event_type,
      user_id: entry.user_id,
      provider: entry.provider,
      severity: entry.severity,
      // Don't log full metadata to avoid sensitive data in logs
      metadata_keys: sanitizedMetadata ? Object.keys(sanitizedMetadata) : [],
    });
  } catch (error: any) {
    logger.error('Error logging audit event', {
      error: error.message,
      stack: error.stack,
      entry,
    });
  }
}

/**
 * Get log level based on severity
 */
function getLogLevel(severity: string): 'info' | 'warn' | 'error' {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warn';
    default:
      return 'info';
  }
}

/**
 * Log authentication events
 */
export async function logAuthEvent(
  event: 'login' | 'logout' | 'token_refresh' | 'token_refresh_failed' | 'oauth_start' | 'oauth_callback' | 'oauth_failed',
  details: {
    userId?: string;
    ip?: string;
    userAgent?: string;
    provider?: string;
    error?: string;
    metadata?: any;
  }
): Promise<void> {
  const severity = event.includes('failed') ? 'high' : 'low';

  await logAuditEvent({
    event_type: `auth_${event}`,
    user_id: details.userId,
    ip_address: details.ip,
    user_agent: details.userAgent,
    provider: details.provider,
    metadata: {
      ...details.metadata,
      error: details.error,
    },
    severity,
  });
}

/**
 * Log token events
 */
export async function logTokenEvent(
  event: 'token_rotated' | 'token_invalidated' | 'token_reuse_detected' | 'token_refresh' | 'token_refresh_failed',
  details: {
    userId?: string;
    ip?: string;
    userAgent?: string;
    provider?: string;
    tokenId?: string;
    reason?: string;
    metadata?: any;
  }
): Promise<void> {
  const severity =
    event.includes('reuse') || event.includes('failed') ? 'high' : 'medium';

  await logAuditEvent({
    event_type: `token_${event}`,
    user_id: details.userId,
    ip_address: details.ip,
    user_agent: details.userAgent,
    provider: details.provider,
    metadata: {
      tokenId: details.tokenId,
      reason: details.reason,
      ...details.metadata,
    },
    severity,
  });
}

/**
 * Log security events
 */
export async function logSecurityEvent(
  event: 'invalid_redirect_uri' | 'invalid_oauth_state' | 'csrf_attack' | 'rate_limit_exceeded' | 'unauthorized_access' | 'suspicious_activity',
  details: {
    userId?: string;
    ip?: string;
    userAgent?: string;
    provider?: string;
    metadata?: any;
  }
): Promise<void> {
  const severity =
    event.includes('attack') || event.includes('unauthorized') || event.includes('suspicious')
      ? 'critical'
      : 'high';

  await logAuditEvent({
    event_type: `security_${event}`,
    user_id: details.userId,
    ip_address: details.ip,
    user_agent: details.userAgent,
    provider: details.provider,
    metadata: details.metadata,
    severity,
  });
}

/**
 * Log security event (convenience wrapper for validateRedirect)
 */
export async function logSecurityEventSimple(event: {
  event: string;
  userId?: string;
  ip?: string;
  details?: any;
}): Promise<void> {
  await logSecurityEvent(event.event as any, {
    userId: event.userId,
    ip: event.ip,
    metadata: event.details,
  });
}

/**
 * Check for alert conditions (e.g., multiple failed refresh attempts)
 */
export async function checkAlertConditions(): Promise<void> {
  try {
    // Check for multiple failed refresh attempts in last 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { data: failedRefreshAttempts, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('event_type', 'token_token_refresh_failed')
      .gte('created_at', fifteenMinutesAgo);

    if (error) {
      logger.error('Error checking alert conditions', { error: error.message });
      return;
    }

    // Group by IP and user
    const attemptsByIp = new Map<string, number>();
    const attemptsByUser = new Map<string, number>();

    failedRefreshAttempts?.forEach((attempt) => {
      if (attempt.ip_address) {
        attemptsByIp.set(
          attempt.ip_address,
          (attemptsByIp.get(attempt.ip_address) || 0) + 1
        );
      }
      if (attempt.user_id) {
        attemptsByUser.set(
          attempt.user_id,
          (attemptsByUser.get(attempt.user_id) || 0) + 1
        );
      }
    });

    // Alert if threshold exceeded
    const threshold = 5; // 5 failed attempts in 15 minutes

    for (const [ip, count] of attemptsByIp.entries()) {
      if (count >= threshold) {
        await logSecurityEvent('suspicious_activity', {
          ip,
          metadata: {
            reason: 'multiple_failed_refresh_attempts',
            count,
            window: '15 minutes',
          },
        });
      }
    }

    for (const [userId, count] of attemptsByUser.entries()) {
      if (count >= threshold) {
        await logSecurityEvent('suspicious_activity', {
          userId,
          metadata: {
            reason: 'multiple_failed_refresh_attempts',
            count,
            window: '15 minutes',
          },
        });
      }
    }
  } catch (error: any) {
    logger.error('Error checking alert conditions', {
      error: error.message,
      stack: error.stack,
    });
  }
}

