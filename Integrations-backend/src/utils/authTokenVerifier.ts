import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env';
import logger from './logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';

export interface VerifiedAuthUser {
  id: string;
  email: string;
  role?: string;
  source: 'backend_jwt' | 'supabase';
}

function normalizeVerifiedUser(decoded: any, source: VerifiedAuthUser['source']): VerifiedAuthUser | null {
  const userId = decoded?.id || decoded?.user_id || decoded?.userId || decoded?.sub;
  if (!userId || typeof userId !== 'string') {
    return null;
  }

  return {
    id: userId,
    email: typeof decoded?.email === 'string' ? decoded.email : '',
    role: typeof decoded?.role === 'string'
      ? decoded.role
      : typeof decoded?.app_metadata?.role === 'string'
        ? decoded.app_metadata.role
        : typeof decoded?.user_metadata?.role === 'string'
          ? decoded.user_metadata.role
          : undefined,
    source
  };
}

export function extractRequestToken(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  const cookieToken = (req as any).cookies?.session_token;
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

async function verifySupabaseAccessToken(token: string): Promise<VerifiedAuthUser | null> {
  const authClient = supabaseAdmin || supabase;
  if (!authClient?.auth?.getUser) {
    return null;
  }

  try {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) {
      return null;
    }

    return normalizeVerifiedUser(data.user, 'supabase');
  } catch (error: any) {
    logger.debug('Supabase access token verification failed', {
      error: error?.message || error
    });
    return null;
  }
}

export async function verifyAccessToken(token: string): Promise<VerifiedAuthUser | null> {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    const verified = normalizeVerifiedUser(decoded, 'backend_jwt');
    if (verified) {
      return verified;
    }
  } catch (_error) {
    // Fall through to Supabase token verification.
  }

  return verifySupabaseAccessToken(token);
}
