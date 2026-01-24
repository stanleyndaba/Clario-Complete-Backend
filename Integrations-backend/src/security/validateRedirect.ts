/**
 * Centralized OAuth Redirect Validation Middleware
 * 
 * Validates redirect URIs, enforces HTTPS, and prevents CSRF attacks
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import oauthStateStore from '../utils/oauthStateStore';

export interface RedirectValidationOptions {
  /** Allowed redirect URI patterns (supports wildcards) */
  allowedRedirectUris: string[];
  /** Whether to enforce HTTPS for redirects */
  enforceHttps: boolean;
  /** Whether to validate state parameter */
  validateState: boolean;
  /** Maximum redirect URI length */
  maxRedirectUriLength: number;
}

/**
 * Default allowed redirect URIs (can be overridden via environment)
 */
const DEFAULT_ALLOWED_REDIRECT_URIS = [
  // Vercel deployments
  'https://*.vercel.app/*',
  'https://*.vercel.com/*',
  // Render deployments
  'https://*.onrender.com/*',
  // Local development
  'http://localhost:*/*',
  'http://127.0.0.1:*/*',
];

/**
 * Get allowed redirect URIs from environment or use defaults
 */
function getAllowedRedirectUris(): string[] {
  const envUris = process.env.ALLOWED_REDIRECT_URIS;
  if (envUris) {
    return envUris.split(',').map(uri => uri.trim());
  }
  return DEFAULT_ALLOWED_REDIRECT_URIS;
}

/**
 * Check if a redirect URI matches an allowed pattern
 */
function matchesPattern(uri: string, pattern: string): boolean {
  try {
    // Exact match
    if (uri === pattern) {
      return true;
    }

    // Wildcard pattern matching
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(uri);
  } catch (error) {
    logger.warn('Error matching redirect URI pattern', { uri, pattern, error });
    return false;
  }
}

/**
 * Validate redirect URI against allowlist
 */
export function validateRedirectUri(
  redirectUri: string,
  options: Partial<RedirectValidationOptions> = {}
): { valid: boolean; error?: string } {
  const config: RedirectValidationOptions = {
    allowedRedirectUris: options.allowedRedirectUris || getAllowedRedirectUris(),
    enforceHttps: options.enforceHttps ?? process.env.NODE_ENV === 'production',
    validateState: options.validateState ?? true,
    maxRedirectUriLength: options.maxRedirectUriLength || 2048,
  };

  // Check length
  if (redirectUri.length > config.maxRedirectUriLength) {
    return {
      valid: false,
      error: `Redirect URI exceeds maximum length of ${config.maxRedirectUriLength} characters`,
    };
  }

  // Parse URI
  let parsedUri: URL;
  try {
    parsedUri = new URL(redirectUri);
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid redirect URI format',
    };
  }

  // Enforce HTTPS in production
  if (config.enforceHttps && parsedUri.protocol !== 'https:') {
    // Allow localhost for development
    if (parsedUri.hostname !== 'localhost' && parsedUri.hostname !== '127.0.0.1') {
      return {
        valid: false,
        error: 'Redirect URI must use HTTPS in production',
      };
    }
  }

  // Check against allowlist
  const isAllowed = config.allowedRedirectUris.some(pattern =>
    matchesPattern(redirectUri, pattern)
  );

  if (!isAllowed) {
    return {
      valid: false,
      error: `Redirect URI not in allowlist: ${redirectUri}`,
    };
  }

  return { valid: true };
}

/**
 * Validate OAuth state parameter to prevent CSRF
 */
export async function validateState(
  state: string | undefined,
  userId?: string
): Promise<{ valid: boolean; error?: string; storedState?: any }> {
  if (!state) {
    return {
      valid: false,
      error: 'State parameter is required',
    };
  }

  // Retrieve stored state (oauthStateStore.get() handles expiration)
  const storedState = await oauthStateStore.get(state);
  if (!storedState) {
    return {
      valid: false,
      error: 'Invalid or expired state parameter',
    };
  }

  // Optional: Validate userId matches (if provided)
  if (userId && storedState.userId && storedState.userId !== userId) {
    return {
      valid: false,
      error: 'State parameter does not match user',
    };
  }

  return {
    valid: true,
    storedState,
  };
}

/**
 * Middleware to validate OAuth redirect URIs and state
 */
export function validateRedirectMiddleware(
  options: Partial<RedirectValidationOptions> = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract redirect URI from query, body, or headers
      const redirectUri =
        (req.query.redirect_uri as string) ||
        (req.body?.redirect_uri as string) ||
        (req.headers['x-redirect-uri'] as string);

      // Extract state parameter
      const state =
        (req.query.state as string) ||
        (req.body?.state as string) ||
        (req.headers['x-oauth-state'] as string);

      // Get user ID if available
      const userId = (req as any).userId || (req as any).user?.id;

      // Validate redirect URI if provided
      if (redirectUri) {
        const validation = validateRedirectUri(redirectUri, options);
        if (!validation.valid) {
          logger.warn('Invalid redirect URI', {
            redirectUri,
            error: validation.error,
            ip: req.ip,
            userId,
          });

          // Log security event
          await logSecurityEvent({
            event: 'invalid_redirect_uri',
            userId,
            ip: req.ip,
            details: {
              redirectUri,
              error: validation.error,
            },
          });

          return res.status(400).json({
            error: 'Invalid redirect URI',
            message: validation.error,
          });
        }
      }

      // Validate state if provided and validation is enabled
      if (options.validateState !== false && state) {
        const stateValidation = await validateState(state, userId);
        if (!stateValidation.valid) {
          logger.warn('Invalid OAuth state', {
            state: state.substring(0, 10) + '...',
            error: stateValidation.error,
            ip: req.ip,
            userId,
          });

          // Log security event
          await logSecurityEvent({
            event: 'invalid_oauth_state',
            userId,
            ip: req.ip,
            details: {
              error: stateValidation.error,
            },
          });

          return res.status(400).json({
            error: 'Invalid state parameter',
            message: stateValidation.error,
          });
        }

        // Attach stored state to request for use in handlers
        (req as any).oauthState = stateValidation.storedState;
      }

      next();
    } catch (error: any) {
      logger.error('Error in redirect validation middleware', {
        error: error.message,
        stack: error.stack,
      });
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to validate redirect',
      });
    }
  };
}

/**
 * Log security events using audit logger
 */
async function logSecurityEvent(event: {
  event: string;
  userId?: string;
  ip?: string;
  details?: any;
}): Promise<void> {
  try {
    const { logSecurityEvent: auditLogSecurityEvent } = await import('./auditLogger');
    // Map event string to valid security event type
    const eventType = event.event.replace('security_', '') as any;
    await auditLogSecurityEvent(eventType, {
      userId: event.userId,
      ip: event.ip,
      metadata: event.details,
    });
  } catch (error: any) {
    // Fallback to basic logging if audit logger fails
    logger.warn('Security event', {
      event: event.event,
      userId: event.userId,
      ip: event.ip,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Sanitize redirect URI for logging (remove sensitive data)
 */
export function sanitizeRedirectUri(uri: string): string {
  try {
    const url = new URL(uri);
    // Remove query parameters that might contain sensitive data
    url.search = '';
    return url.toString();
  } catch {
    // If URL parsing fails, return masked version
    return uri.substring(0, 50) + '...';
  }
}

