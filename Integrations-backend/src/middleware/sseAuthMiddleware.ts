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
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const authHeader = (req as any).headers?.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      logger.warn('SSE authentication failed: No token provided', {
        url: (req as any).url,
        method: (req as any).method,
        ip: (req as any).ip
      });
      
      // Send error event and close connection
      res.write(`event: error\ndata: ${JSON.stringify({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      })}\n\n`);
      
      res.end();
      return;
    }

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as { id: string; email: string };
      req.user = decoded;
      
      logger.info('SSE authentication successful', {
        user_id: decoded.id,
        url: (req as any).url,
        ip: (req as any).ip
      });

      // Send authentication success event
      res.write(`event: auth_success\ndata: ${JSON.stringify({
        user_id: decoded.id,
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
    return jwt.verify(token, config.JWT_SECRET) as { id: string; email: string };
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



