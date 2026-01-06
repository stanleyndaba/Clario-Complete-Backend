import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '@/config/env';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: number;
    email?: string;
    role?: string;
  };
}

/**
 * JWT Authentication Middleware
 * Verifies JWT token and attaches user info to request
 */
export function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Authorization header is required',
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Bearer token is required',
      });
    }

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as any;
      
      // Attach user info to request
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      };
      
      next();
    } catch (jwtError) {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token is invalid or expired',
      });
    }
  } catch (error) {
    console.error('Error in JWT authentication:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Optional JWT Authentication Middleware
 * Attaches user info if token is present, but doesn't require it
 */
export function optionalJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return next();
    }

    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as any;
      
      // Attach user info to request
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      };
      
      next();
    } catch (jwtError) {
      // Token is invalid, but continue without user info
      next();
    }
  } catch (error) {
    console.error('Error in optional JWT authentication:', error);
    // Continue without user info
    next();
  }
}

/**
 * Role-based Authorization Middleware
 */
export function requireRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'User must be authenticated',
      });
    }

    if (!req.user.role || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Insufficient permissions for this operation',
      });
    }

    next();
  };
}

/**
 * Admin-only Authorization Middleware
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return requireRole(['admin'])(req, res, next);
}

/**
 * Generate JWT token for testing/development
 */
export function generateTestToken(userId: number, email?: string, role: string = 'user'): string {
  return jwt.sign(
    { userId, email, role },
    config.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Verify JWT token and return decoded payload
 */
export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
}


