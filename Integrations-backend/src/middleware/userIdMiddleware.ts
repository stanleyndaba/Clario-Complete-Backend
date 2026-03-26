import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { convertUserIdToUuid } from '../database/supabaseClient';
import { extractRequestToken, verifyAccessToken } from '../utils/authTokenVerifier';

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Allow demo user in sandbox/development mode or when explicitly enabled
const isSandboxOrDev = process.env.NODE_ENV !== 'production' ||
  process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox') ||
  process.env.USE_MOCK_DATA_GENERATOR === 'true';
const allowDemoUser = process.env.ALLOW_DEMO_USER === 'true' || isSandboxOrDev;

// Paths that should skip user ID extraction (public endpoints)
const PUBLIC_PATHS = [
  '/health',
  '/healthz',
  '/',
  '/api/status',
  '/api/metrics/track',
  '/favicon.ico',
  '/robots.txt'
];

// Path prefixes that should skip user ID extraction
const PUBLIC_PATH_PREFIXES = [
  '/api/auth',        // Auth endpoints handle their own authentication
  '/api/amazon/callback', // OAuth callbacks
  '/api/v1/integrations/amazon/auth', // Amazon OAuth
  '/api/v1/integrations/gmail/auth',  // Gmail OAuth
  '/api/v1/integrations/outlook/auth', // Outlook OAuth
  '/api/v1/integrations/gdrive/auth',  // Google Drive OAuth
  '/api/v1/integrations/dropbox/auth', // Dropbox OAuth
];

// Agent 2 ingestion and sync routes must always require a real authenticated identity.
const FAIL_CLOSED_AUTH_PREFIXES = [
  '/api/sync',
  '/api/v1/integrations/sync',
  '/api/csv-upload/ingest'
];

function extractUuid(candidate?: string | null): string | null {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return null;
  }

  const embedded = candidate.match(UUID_REGEX);
  return embedded?.[0] || null;
}

function hasTrustedInternalApiKey(req: Request): boolean {
  const configuredKey = process.env.INTERNAL_API_KEY;
  if (!configuredKey || configuredKey.trim().length === 0) {
    return false;
  }

  const providedKey = req.headers['x-internal-api-key'] || req.headers['x-api-key'];
  return typeof providedKey === 'string' && providedKey === configuredKey;
}

/**
 * Middleware to extract a trusted user ID from verified auth or an explicitly trusted internal forward.
 */
export async function userIdMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Use originalUrl for path matching (req.path strips mount path in subrouters)
    const fullPath = req.originalUrl?.split('?')[0] || req.path;

    // Skip user ID extraction for public paths (health checks, status, etc.)
    const isPublicPath = PUBLIC_PATHS.some(path =>
      fullPath === path || fullPath.startsWith(path + '/')
    );

    // Also skip for public path prefixes (auth endpoints, OAuth callbacks)
    const isPublicPrefix = PUBLIC_PATH_PREFIXES.some(prefix =>
      fullPath.startsWith(prefix)
    );

    if (isPublicPath || isPublicPrefix) {
      return next();
    }

    let userId: string | undefined;
    let identitySource = 'none';

    const requestToken = extractRequestToken(req);
    if (requestToken) {
      const verified = await verifyAccessToken(requestToken);
      const verifiedId = extractUuid(verified?.id);
      if (verifiedId) {
        userId = verifiedId;
        identitySource = verified?.source === 'supabase' ? 'verified-supabase-token' : 'verified-backend-jwt';
      }
    }

    if (!userId && (req as any).user?.id && hasTrustedInternalApiKey(req)) {
      const trustedUserId = extractUuid((req as any).user.id);
      if (trustedUserId) {
        userId = trustedUserId;
        identitySource = 'trusted-req-user-id';
      }
    }

    if (!userId && (req as any).user?.user_id && hasTrustedInternalApiKey(req)) {
      const trustedUserId = extractUuid((req as any).user.user_id);
      if (trustedUserId) {
        userId = trustedUserId;
        identitySource = 'trusted-req-user-user_id';
      }
    }

    if (!userId && hasTrustedInternalApiKey(req)) {
      const forwardedUserId = extractUuid(req.headers['x-user-id'] as string);
      if (forwardedUserId) {
        userId = forwardedUserId;
        identitySource = 'trusted-x-user-id';
      }
    }

    if (!userId && hasTrustedInternalApiKey(req)) {
      const forwardedUserId = extractUuid(req.headers['x-forwarded-user-id'] as string);
      if (forwardedUserId) {
        userId = forwardedUserId;
        identitySource = 'trusted-x-forwarded-user-id';
      }
    }

    // POISON CHECK: The Null Identity Poison Trap
    // Intercept and destroy requests carrying the legacy "Zero-Bucket" identifier
    if (userId === '00000000-0000-0000-0000-000000000000') {
      logger.warn('IDENTITY_POISON_TRAP: Intercepted Null UUID request', {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        path: req.path,
        method: req.method
      });

      res.status(403).json({
        error: 'SECURITY_IDENTITY_MISMATCH',
        message: 'Your session identity is deprecated. Please re-authenticate to synchronize with the Unified Identity layer.',
        action: 'FORCE_LOGOUT',
        code: 403
      });
      return;
    }

    // Intercept 'demo-user' string explicitly sent from frontend headers/params
    if (userId === 'demo-user' && allowDemoUser) {
      userId = convertUserIdToUuid('demo-user');
    }

    if (!userId) {
      const mustFailClosed = FAIL_CLOSED_AUTH_PREFIXES.some(prefix =>
        fullPath === prefix || fullPath.startsWith(prefix + '/')
      );

      if (mustFailClosed) {
        logger.warn('Protected Agent 2 route called without authenticated identity', {
          path: fullPath,
          method: req.method,
          ip: req.ip
        });
        res.status(401).json({ error: 'User authentication required' });
        return;
      }

      if (allowDemoUser) {
        userId = convertUserIdToUuid('demo-user');
        identitySource = 'default-demo-user';
        logger.debug('Demo mode enabled - falling back to demo-user', {
          path: req.path,
          method: req.method
        });
      } else {
        // Log with path context for debugging
        logger.warn('No user ID found in request', {
          path: req.path,
          method: req.method,
          ip: req.ip,
          headers: Object.keys(req.headers)
        });
        res.status(401).json({ error: 'User authentication required' });
        return;
      }
    }

    // Handle prefixed UUIDs (e.g. stress-test-user-UUID)
    // This fixes the issue where valid users are rejected because of the prefix
    if (userId) {
      const uuidMatch = userId.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      if (uuidMatch) {
        // If we found a UUID inside the string, use that as the official ID for validation
        userId = uuidMatch[0];
      }
    }

    if (!UUID_REGEX.test(userId)) {
      logger.warn('Invalid user ID format (expected UUID)', { userId, path: req.path });
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    // Set userId on request object for use in route handlers
    (req as any).userId = userId;

    // Also set req.user if it doesn't exist (for compatibility)
    if (!(req as any).user) {
      (req as any).user = { id: userId, user_id: userId };
    } else {
      // Ensure user object has id and user_id
      (req as any).user.id = (req as any).user.id || userId;
      (req as any).user.user_id = (req as any).user.user_id || userId;
    }

    // Log user ID extraction for observability
    logger.debug('User ID extracted from request', {
      userId,
      path: req.path,
      method: req.method,
      source: identitySource
    });

    next();
  } catch (error: any) {
    logger.error('Error in userIdMiddleware', { error: error?.message });
    res.status(500).json({ error: 'Failed to extract user ID' });
  }
}

