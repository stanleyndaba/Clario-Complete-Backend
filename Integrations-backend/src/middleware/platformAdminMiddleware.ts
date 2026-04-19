import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

function hasTrustedInternalApiKey(req: Request): boolean {
  const configuredKey = process.env.INTERNAL_API_KEY;
  if (!configuredKey || configuredKey.trim().length === 0) {
    return false;
  }

  const providedKey = req.headers['x-internal-api-key'] || req.headers['x-api-key'];
  return typeof providedKey === 'string' && providedKey === configuredKey;
}

function getRequestUserId(req: Request): string | null {
  const request = req as any;
  return request.userId || request.user?.id || request.user?.user_id || null;
}

export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (hasTrustedInternalApiKey(req)) {
      return next();
    }

    const userId = getRequestUserId(req);
    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'ADMIN_AUTH_REQUIRED'
      });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, role, status, deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      logger.warn('[ADMIN] Failed to verify platform admin role', {
        userId,
        path: req.originalUrl,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'ADMIN_ROLE_LOOKUP_FAILED'
      });
      return;
    }

    const role = String(data?.role || '').toLowerCase();
    const status = String(data?.status || 'active').toLowerCase();
    const isDeleted = Boolean(data?.deleted_at);
    const isLocked = ['locked', 'disabled', 'suspended', 'deleted'].includes(status);

    if (role !== 'admin' || isDeleted || isLocked) {
      logger.warn('[ADMIN] Non-admin request blocked', {
        userId,
        email: data?.email || null,
        role: data?.role || null,
        status: data?.status || null,
        path: req.originalUrl
      });
      res.status(403).json({
        success: false,
        error: 'PLATFORM_ADMIN_REQUIRED'
      });
      return;
    }

    return next();
  } catch (error: any) {
    logger.error('[ADMIN] Platform admin guard failed', {
      path: req.originalUrl,
      error: error?.message || String(error)
    });
    res.status(500).json({
      success: false,
      error: 'ADMIN_GUARD_FAILED'
    });
  }
}

export default requirePlatformAdmin;
