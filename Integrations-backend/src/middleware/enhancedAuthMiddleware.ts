import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env';
import logger from '../utils/logger';
import { createError } from '../utils/errorHandler';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role?: string;
  };
}

// Define public routes that don't require authentication
const PUBLIC_ROUTES = [
  { method: 'GET', path: '/health' },
  { method: 'GET', path: '/api/status' },
  { method: 'GET', path: '/api/amazon/callback' },
  { method: 'GET', path: '/api/amazon/auth' }, // OAuth initiation should be public
  { method: 'POST', path: '/api/metrics/track' },
  { method: 'OPTIONS', path: '*' }, // Always allow preflight requests
];

// Check if a route is public
function isPublicRoute(req: Request): boolean {
  return PUBLIC_ROUTES.some(route => 
    route.method === (req as any).method && 
    (route.path === '*' || (req as any).path?.startsWith(route.path))
  );
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  // Allow OPTIONS requests (preflight)
  if ((req as any).method === 'OPTIONS') {
    return next();
  }

  // Check if route is public
  if (isPublicRoute(req)) {
    return next();
  }

  const authHeader = (req as any).headers?.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    logger.warn('Authentication failed: No token provided', {
      url: (req as any).url,
      method: (req as any).method,
      ip: (req as any).ip
    });
    res.status(401).json({
      success: false,
      message: 'Access token required'
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as { id: string; email: string };
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn('Authentication failed: Invalid token', {
      error: error instanceof Error ? error.message : 'Unknown error',
      url: (req as any).url,
      method: (req as any).method,
      ip: (req as any).ip
    });
    res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
    return;
  }
  next();
};

export const generateToken = (userId: string, email: string): string => {
  const secret = config.JWT_SECRET || 'demo-secret-change-me';
  
  return jwt.sign(
    { id: userId, email },
    secret
  ) as string;
};

export const verifyToken = (token: string): { id: string; email: string } => {
  try {
    return jwt.verify(token, config.JWT_SECRET) as { id: string; email: string };
  } catch (error) {
    throw createError('Invalid token', 401);
  }
};
