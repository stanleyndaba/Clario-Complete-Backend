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

    const [{ data: authority, error: authorityError }, { data: user, error: userError }] = await Promise.all([
      supabaseAdmin
        .from('platform_admins')
        .select('user_id, status, revoked_at')
        .eq('user_id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('users')
        .select('id, email, deleted_at')
        .eq('id', userId)
        .maybeSingle()
    ]);

    if (authorityError || userError) {
      logger.warn('[ADMIN] Failed to verify platform administrator authority', {
        userId,
        path: req.originalUrl,
        authorityError: authorityError?.message || null,
        userError: userError?.message || null
      });
      res.status(500).json({
        success: false,
        error: 'ADMIN_AUTHORITY_LOOKUP_FAILED'
      });
      return;
    }

    const authorityStatus = String(authority?.status || '').toLowerCase();
    const isActiveAuthority = authorityStatus === 'active' && !authority?.revoked_at;
    const isDeleted = Boolean(user?.deleted_at);

    if (!isActiveAuthority || isDeleted) {
      logger.warn('[ADMIN] Non-admin request blocked', {
        userId,
        email: user?.email || null,
        authorityStatus: authority?.status || null,
        revokedAt: authority?.revoked_at || null,
        deletedAt: user?.deleted_at || null,
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
