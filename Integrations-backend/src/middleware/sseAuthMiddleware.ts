import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env';
import logger from '../utils/logger';
import { normalizeAgent10EventPayload } from '../utils/agent10Event';
import { verifyAccessToken } from '../utils/authTokenVerifier';

export interface AuthenticatedSSERequest extends Request {
  user?: {
    id: string;
    email: string;
    role?: string;
  };
}

const DEMO_TENANT_SLUG = 'demo-workspace';
const ALLOW_EXPLICIT_DEMO_SSE = process.env.ALLOW_DEMO_USER === 'true';

function getExplicitDemoSignal(req: Request): boolean {
  if (!ALLOW_EXPLICIT_DEMO_SSE) {
    return false;
  }

  const requestLike = req as any;
  const queryTenantSlug = String(requestLike.query?.tenantSlug || '').trim();
  const url = String(requestLike.originalUrl || requestLike.url || '');
  const pathMatch = url.match(/\/app\/([^\/?]+)/);
  const pathTenantSlug = pathMatch?.[1] || '';
  const demoHeader = String(requestLike.headers?.['x-demo-mode'] || '').trim().toLowerCase();

  return queryTenantSlug === DEMO_TENANT_SLUG || pathTenantSlug === DEMO_TENANT_SLUG || demoHeader === 'true';
}

function applySSEHeaders(req: AuthenticatedSSERequest, res: Response): void {
  const origin = (req as any).headers?.origin;
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  };

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Access-Control-Allow-Headers'] = 'Cache-Control, Authorization';
  }

  res.writeHead(200, headers);
}

export function openAuthenticatedSSEStream(req: AuthenticatedSSERequest, res: Response): void {
  applySSEHeaders(req, res);

  if (req.user?.id) {
    res.write(`event: auth_success\ndata: ${JSON.stringify({
      user_id: req.user.id,
      timestamp: new Date().toISOString()
    })}\n\n`);
  }
}

/**
 * JWT authentication middleware for Server-Sent Events
 * Validates JWT token and injects seller_id for data filtering
 */
export const authenticateSSE = async (
  req: AuthenticatedSSERequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get origin for CORS - validate against allowed origins
    const origin = (req as any).headers?.origin;

    // Validate origin against allowed patterns (same as main CORS config)
    if (origin) {
      const isAllowed =
        origin.includes('vercel.app') ||
        origin.includes('onrender.com') ||
        origin.includes('vercel.com') ||
        origin.includes('margin-finance.com') ||
        origin.includes('localhost');

      if (!isAllowed) {
        // If origin not allowed, don't set CORS headers (will be blocked by browser)
        logger.warn('SSE connection from disallowed origin', { origin });
      }
    }

    // EventSource can't send custom headers, so we need to support cookies
    // Priority 1: Check cookie (session_token) - this is how EventSource sends auth
    const cookieToken = (req as any).cookies?.session_token;

    // Priority 2: Check Authorization header (for testing with curl/Postman)
    const authHeader = (req as any).headers?.authorization;
    const headerToken = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // Use cookie token if available, otherwise use header token
    const token = cookieToken || headerToken;

    if (!token) {
      if (getExplicitDemoSignal(req)) {
        logger.info('SSE connection without authentication - using isolated demo mode', {
          url: (req as any).url,
          method: (req as any).method,
          ip: (req as any).ip
        });

        req.user = {
          id: 'demo-user',
          email: 'demo@example.com'
        };

        next();
        return;
      }

      logger.warn('SSE connection rejected without authentication', {
        url: (req as any).url,
        method: (req as any).method,
        ip: (req as any).ip
      });

      res.status(401).json({
        error: 'Authentication is required for SSE',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    try {
      const decoded = await verifyAccessToken(token);
      if (!decoded) {
        throw new Error('Invalid or expired token');
      }

      // Normalize user ID - handle different token formats (id, user_id, userId)
      const userId = decoded.id;
      const email = decoded.email || '';

      if (!userId) {
        logger.warn('SSE authentication failed: No user ID in token', {
          tokenKeys: Object.keys(decoded),
          url: (req as any).url
        });

        res.status(401).json({
          error: 'Invalid token format',
          code: 'INVALID_TOKEN_FORMAT'
        });
        return;
      }

      // Set normalized user object
      req.user = {
        id: userId,
        email: email,
        role: decoded.role
      };

      logger.info('✅ [SSE AUTH] SSE authentication successful', {
        user_id: userId,
        email: email,
        url: (req as any).url,
        ip: (req as any).ip,
        note: 'Sync operations must use the same userId for SSE events to work'
      });

      next();
    } catch (error) {
      logger.warn('SSE authentication failed: Invalid token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url: (req as any).url,
        method: (req as any).method,
        ip: (req as any).ip
      });

      res.status(401).json({
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }
  } catch (error) {
    logger.error('Error in SSE authentication middleware', { error });

    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * Verify JWT token and return decoded payload
 */
export const verifySSEToken = (token: string): { id: string; email: string } => {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    const userId = decoded.id || decoded.user_id || decoded.userId;
    return {
      id: userId,
      email: decoded.email || ''
    };
  } catch (error) {
    throw new Error('Invalid token');
  }
};

/**
 * Generate SSE event data with proper formatting
 */
export const sendSSEEvent = (
  res: Response,
  event: string,
  data: any,
  id?: string
): void => {
  try {
    const normalized = normalizeAgent10EventPayload(event, data);
    let eventData = `event: ${event}\n`;

    if (id) {
      eventData += `id: ${id}\n`;
    }

    eventData += `data: ${JSON.stringify(normalized)}\n\n`;

    res.write(eventData);
  } catch (error) {
    logger.error('Error sending SSE event', { error, event, data });
  }
};

/**
 * Send SSE heartbeat to keep connection alive
 */
export const sendSSEHeartbeat = (res: Response): void => {
  try {
    res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
  } catch (error) {
    logger.error('Error sending SSE heartbeat', { error });
  }
};

/**
 * Close SSE connection gracefully
 */
export const closeSSEConnection = (res: Response): void => {
  try {
    res.write(`event: close\ndata: ${JSON.stringify({
      message: 'Connection closed',
      timestamp: new Date().toISOString()
    })}\n\n`);

    res.end();
  } catch (error) {
    logger.error('Error closing SSE connection', { error });
    res.end();
  }
};



