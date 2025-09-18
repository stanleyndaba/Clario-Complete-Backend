import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
    }
  }
}

export interface JWTPayload {
  id: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export class AuthMiddleware {
  private static readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

  /**
   * Verify JWT token and set user context
   */
  static authenticateToken(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ 
        error: 'Access token required',
        message: 'Please provide a valid JWT token in the Authorization header'
      });
      return;
    }

    try {
      const decoded = jwt.verify(token, AuthMiddleware.JWT_SECRET) as JWTPayload;
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role
      };
      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        res.status(401).json({ 
          error: 'Invalid token',
          message: 'The provided token is invalid or expired'
        });
      } else {
        res.status(500).json({ 
          error: 'Token verification failed',
          message: 'An error occurred while verifying the token'
        });
      }
    }
  }

  /**
   * Optional authentication - doesn't fail if no token provided
   */
  static optionalAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      next();
      return;
    }

    try {
      const decoded = jwt.verify(token, AuthMiddleware.JWT_SECRET) as JWTPayload;
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role
      };
      next();
    } catch (error) {
      // For optional auth, we just continue without setting user
      next();
    }
  }

  /**
   * Check if user has required role
   */
  static requireRole(requiredRole: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({ 
          error: 'Authentication required',
          message: 'User authentication is required for this operation'
        });
        return;
      }

      if (req.user.role !== requiredRole && req.user.role !== 'admin') {
        res.status(403).json({ 
          error: 'Insufficient permissions',
          message: `Role '${requiredRole}' is required for this operation`
        });
        return;
      }

      next();
    };
  }

  /**
   * Generate JWT token for testing purposes
   */
  static generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, AuthMiddleware.JWT_SECRET, { expiresIn: '24h' });
  }

  /**
   * Validate token without setting user context
   */
  static validateToken(token: string): JWTPayload | null {
    try {
      return jwt.verify(token, AuthMiddleware.JWT_SECRET) as JWTPayload;
    } catch (error) {
      return null;
    }
  }
}

// Export middleware functions
export const authenticateToken = AuthMiddleware.authenticateToken;
export const optionalAuth = AuthMiddleware.optionalAuth;
export const requireRole = AuthMiddleware.requireRole;
export const generateToken = AuthMiddleware.generateToken;
export const validateToken = AuthMiddleware.validateToken; 