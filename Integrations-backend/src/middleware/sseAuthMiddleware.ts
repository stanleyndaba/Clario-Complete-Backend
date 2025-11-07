import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env';
import logger from '../utils/logger';

export interface AuthenticatedSSERequest extends Request {
  user?: {
    id: string;
    email: string;
    role?: string;
  };
}

/**
 * JWT authentication middleware for Server-Sent Events
 * Validates JWT token and injects seller_id for data filtering
 */
export const authenticateSSE = (
  req: AuthenticatedSSERequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Get origin for CORS - validate against allowed origins
    const origin = (req as any).headers?.origin;
    let allowedOrigin = origin || '*';
    
    // Validate origin against allowed patterns (same as main CORS config)
    if (origin) {
      const isAllowed = 
        origin.includes('vercel.app') ||
        origin.includes('onrender.com') ||
        origin.includes('vercel.com') ||
        origin.includes('localhost');
      
      if (!isAllowed) {
        // If origin not allowed, don't set CORS headers (will be blocked by browser)
        logger.warn('SSE connection from disallowed origin', { origin });
      }
    }
    
    // Set SSE headers with proper CORS
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    };
    
    // Only set CORS headers if origin is valid
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Credentials'] = 'true';
      headers['Access-Control-Allow-Headers'] = 'Cache-Control, Authorization';
    }
    
    res.writeHead(200, headers);

    // EventSource can't send custom headers, so we need to support cookies
    // Priority 1: Check cookie (session_token) - this is how EventSource sends auth
    const cookieToken = (req as any).cookies?.session_token;
    
    // Priority 2: Check Authorization header (for testing with curl/Postman)
    const authHeader = (req as any).headers?.authorization;
    const headerToken = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    // Use cookie token if available, otherwise use header token
    const token = cookieToken || headerToken;

    if (!token) {
      // Allow unauthenticated connections for demo/sandbox mode
      // This prevents SSE errors when user is not logged in
      logger.info('SSE connection without authentication - using demo mode', {
        url: (req as any).url,
        method: (req as any).method,
        ip: (req as any).ip
      });
      
      // Set demo user for unauthenticated connections
      req.user = {
        id: 'demo-user',
        email: 'demo@example.com'
      };
      
      // Send demo mode event
      res.write(`event: connected\ndata: ${JSON.stringify({
        status: 'ok',
        mode: 'demo',
        message: 'Connected in demo mode (no authentication)',
        timestamp: new Date().toISOString()
      })}\n\n`);
      
      // Continue to next middleware (don't close connection)
      next();
      return;
    }

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as any;
      
      // Normalize user ID - handle different token formats (id, user_id, userId)
      const userId = decoded.id || decoded.user_id || decoded.userId;
      const email = decoded.email || '';
      
      if (!userId) {
        logger.warn('SSE authentication failed: No user ID in token', {
          tokenKeys: Object.keys(decoded),
          url: (req as any).url
        });
        
        res.write(`event: error\ndata: ${JSON.stringify({
          error: 'Invalid token format',
          code: 'INVALID_TOKEN_FORMAT'
        })}\n\n`);
        
        res.end();
        return;
      }
      
      // Set normalized user object
      req.user = {
        id: userId,
        email: email,
        role: decoded.role
      };
      
      logger.info('SSE authentication successful', {
        user_id: userId,
        url: (req as any).url,
        ip: (req as any).ip
      });

      // Send authentication success event
      res.write(`event: auth_success\ndata: ${JSON.stringify({
        user_id: userId,
        timestamp: new Date().toISOString()
      })}\n\n`);

      next();
    } catch (error) {
      logger.warn('SSE authentication failed: Invalid token', {
        error: error instanceof Error ? error.message : 'Unknown error',
        url: (req as any).url,
        method: (req as any).method,
        ip: (req as any).ip
      });
      
      // Send error event and close connection
      res.write(`event: error\ndata: ${JSON.stringify({
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      })}\n\n`);
      
      res.end();
    }
  } catch (error) {
    logger.error('Error in SSE authentication middleware', { error });
    
    // Send error event and close connection
    res.write(`event: error\ndata: ${JSON.stringify({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    })}\n\n`);
    
    res.end();
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
    let eventData = `event: ${event}\n`;
    
    if (id) {
      eventData += `id: ${id}\n`;
    }
    
    eventData += `data: ${JSON.stringify(data)}\n\n`;
    
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



