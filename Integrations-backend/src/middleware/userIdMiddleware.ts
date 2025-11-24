import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const allowDemoUser = process.env.ALLOW_DEMO_USER === 'true';

// Paths that should skip user ID extraction (public endpoints)
const PUBLIC_PATHS = [
  '/health',
  '/healthz',
  '/',
  '/api/status',
  '/api/metrics/track'
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
    // Skip user ID extraction for public paths (health checks, status, etc.)
    const isPublicPath = PUBLIC_PATHS.some(path => 
      req.path === path || req.path.startsWith(path + '/')
    );
    
    if (isPublicPath) {
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
    
    // Priority 5: Query parameter (fallback for testing)
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
        logger.warn('No user ID found in request');
        res.status(401).json({ error: 'User authentication required' });
        return;
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
              req.query?.userId ? 'query-param' :
              allowDemoUser ? 'default-demo-user' : 'n/a'
    });
    
    next();
  } catch (error: any) {
    logger.error('Error in userIdMiddleware', { error: error?.message });
    res.status(500).json({ error: 'Failed to extract user ID' });
  }
}

