import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getLogger } from '../../../shared/utils/logger';

const logger = getLogger('AuthMiddleware');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token is required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
      if (err) {
        logger.warn('Invalid token provided:', err.message);
        res.status(403).json({
          success: false,
          message: 'Invalid or expired token',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Add user information to request
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
      };

      logger.info(`Authenticated user: ${decoded.email}`);
      next();
    });

  } catch (error) {
    logger.error('Authentication middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Authentication failed',
      timestamp: new Date().toISOString(),
    });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (!roles.includes(req.user.role)) {
        logger.warn(`User ${req.user.email} attempted to access restricted resource. Role: ${req.user.role}, Required: ${roles.join(', ')}`);
        res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      next();

    } catch (error) {
      logger.error('Role verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: 'Role verification failed',
        timestamp: new Date().toISOString(),
      });
    }
  };
};

export const requireAdmin = requireRole(['admin']);
export const requireUser = requireRole(['admin', 'user']);
export const requireViewer = requireRole(['admin', 'user', 'viewer']); 