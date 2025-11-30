import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

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
];

/**
 * Middleware to extract user ID from headers or cookies
 * 
 * Priority order:
 * 1. X-User-Id header (set by Python API when forwarding requests)
 * 2. X-Forwarded-User-Id header (alternative header name)
 * 3. req.user.id (if auth middleware sets it)
 * 4. req.user.user_id (alternative user ID field)
 * 5. Cookie session_token (decode JWT if needed)
 * 6. Query parameter userId (fallback for testing)
 * 
 * Sets req.userId for use in route handlers
 */
export function userIdMiddleware(req: Request, res: Response, next: NextFunction): void {
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
    // Priority 1: X-User-Id header (set by Python API)
    let userId: string | undefined = req.headers['x-user-id'] as string;

    // Priority 2: X-Forwarded-User-Id header (alternative)
    if (!userId) {
      userId = req.headers['x-forwarded-user-id'] as string;
    }

    // Priority 3: req.user.id (if auth middleware sets it)
    if (!userId && (req as any).user?.id) {
      userId = (req as any).user.id;
    }

    // Priority 4: req.user.user_id (alternative user ID field)
    if (!userId && (req as any).user?.user_id) {
      userId = (req as any).user.user_id;
    }

    // Priority 5: Cookie session_token (decode JWT if needed)
    if (!userId && req.cookies?.session_token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(req.cookies.session_token);
        if (decoded && (decoded.sub || decoded.id || decoded.user_id)) {
          userId = decoded.sub || decoded.id || decoded.user_id;
        }
      } catch (e) {
        // Ignore decode errors
      }
    }

    // Priority 6: Authorization header (Bearer token)
    if (!userId && req.headers.authorization?.startsWith('Bearer ')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(token);
        if (decoded && (decoded.sub || decoded.id || decoded.user_id)) {
          userId = decoded.sub || decoded.id || decoded.user_id;
        }
      } catch (e) {
        // Ignore decode errors
      }
    }

    // Priority 7: Query parameter (fallback for testing)
    if (!userId && req.query?.userId) {
      userId = req.query.userId as string;
    }

    if (!userId) {
      if (allowDemoUser) {
        userId = 'demo-user';
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
    if (userId && userId !== 'demo-user') {
      const uuidMatch = userId.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      if (uuidMatch) {
        // If we found a UUID inside the string, use that as the official ID for validation
        // But keep the original ID if it was just a prefix, or maybe we should strip it?
        // For now, let's just allow it if it contains a UUID, but we need to pass the regex check below.
        // The regex check below expects *only* a UUID.
        // So we MUST extract it.
        userId = uuidMatch[0];
      }
    }

    if (userId !== 'demo-user' && !UUID_REGEX.test(userId)) {
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
      source: req.headers['x-user-id'] ? 'x-user-id-header' :
        req.headers['x-forwarded-user-id'] ? 'x-forwarded-user-id-header' :
          (req as any).user?.id ? 'req.user.id' :
            req.headers.authorization ? 'auth-header' :
              req.cookies?.session_token ? 'session-cookie' :
                req.query?.userId ? 'query-param' :
                  allowDemoUser ? 'default-demo-user' : 'n/a'
    });

    next();
  } catch (error: any) {
    logger.error('Error in userIdMiddleware', { error: error?.message });
    res.status(500).json({ error: 'Failed to extract user ID' });
  }
}

