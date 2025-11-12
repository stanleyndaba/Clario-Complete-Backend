import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env';
import logger from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role?: string;
  };
}

export const authenticateToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = (req as any).headers?.['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Access token required'
    });
    return;
  }

  try {
    // Check if token is Supabase service role key (for sandbox testing)
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey && token === serviceRoleKey) {
      // Extract user ID from X-User-Id header or use default
      const userId = (req as any).headers?.['x-user-id'] || (req as any).userId || 'service-role-user';
      req.user = {
        id: userId,
        email: 'service-role@supabase.local',
        role: 'service_role'
      };
      logger.debug('Service role key authentication successful', { userId });
      next();
      return;
    }

    // Try to verify as JWT token (standard authentication)
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    req.user = {
      id: decoded.userId || decoded.id,
      email: decoded.email,
      role: decoded.role
    };
    next();
  } catch (error) {
    logger.error('JWT verification failed', { error });
    res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

export const generateToken = (payload: { userId: string; email: string; role: string }) => {
  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '24h' });
};
