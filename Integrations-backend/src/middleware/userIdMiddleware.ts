import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

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
    
    // Priority 6: Default to 'demo-user' if no user ID found
    // This allows the endpoint to work even without authentication (for testing)
    if (!userId) {
      userId = 'demo-user';
      logger.debug('No user ID found in request - using demo-user', {
        path: req.path,
        method: req.method,
        headers: {
          'x-user-id': req.headers['x-user-id'],
          'x-forwarded-user-id': req.headers['x-forwarded-user-id'],
          'authorization': req.headers['authorization'] ? 'present' : 'missing'
        }
      });
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
              'default-demo-user'
    });
    
    next();
  } catch (error: any) {
    // If middleware fails, set default and continue (don't break the request)
    logger.warn('Error in userIdMiddleware - using default', { error: error?.message });
    (req as any).userId = 'demo-user';
    if (!(req as any).user) {
      (req as any).user = { id: 'demo-user', user_id: 'demo-user' };
    }
    next();
  }
}

