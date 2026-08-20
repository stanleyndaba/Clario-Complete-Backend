import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { createClerkClient, verifyToken as verifyClerkToken } from '@clerk/express';
import config from '../config/env';
import logger from './logger';
import { supabase, supabaseAdmin } from '../database/supabaseClient';

export interface VerifiedAuthUser {
  id: string;
  email: string;
  role?: string;
  source: 'backend_jwt' | 'clerk' | 'supabase';
  // Present only for Clerk-authenticated requests. `id` may be the resolved
  // canonical Margin UUID, so callers must use this raw subject for Clerk API
  // operations and `users.clerk_user_id` persistence.
  clerkUserId?: string;
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

function getClerkSecretKey(): string | null {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  return secretKey || null;
}

async function resolveCanonicalClerkLinkedUser(clerkUserId: string): Promise<{ id: string } | null> {
  const authClient = supabaseAdmin || supabase;
  const { data: candidates, error: candidatesError } = await authClient
    .from('users')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .is('deleted_at', null);

  if (candidatesError) {
    if (candidatesError.code !== '42703') {
      logger.debug('Clerk identity mapping lookup failed', {
        error: candidatesError.message || 'Unknown Clerk mapping lookup error'
      });
    }
    return null;
  }

  const linkedUsers = (Array.isArray(candidates) ? candidates : candidates ? [candidates] : [])
    .filter((candidate) => typeof candidate?.id === 'string' && candidate.id.length > 0);
  if (linkedUsers.length <= 1) {
    return linkedUsers[0] || null;
  }

  const candidateIds = linkedUsers.map((candidate) => candidate.id);
  const { data: memberships, error: membershipsError } = await authClient
    .from('tenant_memberships')
    .select('user_id')
    .in('user_id', candidateIds)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (membershipsError) {
    logger.debug('Clerk identity membership ranking failed', {
      error: membershipsError.message || 'Unknown Clerk membership ranking error'
    });
    return null;
  }

  const membershipCounts = new Map<string, number>();
  for (const membership of Array.isArray(memberships) ? memberships : []) {
    if (typeof membership?.user_id === 'string') {
      membershipCounts.set(membership.user_id, (membershipCounts.get(membership.user_id) || 0) + 1);
    }
  }

  const rankedUsers = linkedUsers
    .map((candidate) => ({ candidate, memberships: membershipCounts.get(candidate.id) || 0 }))
    .sort((left, right) => right.memberships - left.memberships);
  const top = rankedUsers[0];
  const tied = rankedUsers.filter((entry) => entry.memberships === top.memberships);

  if (!top.memberships || tied.length !== 1) {
    logger.warn('Ambiguous Clerk identity mapping failed closed', {
      candidateCount: linkedUsers.length,
      activeMembershipCounts: rankedUsers.map((entry) => entry.memberships)
    });
    return null;
  }

  return top.candidate;
}

async function verifyClerkAccessToken(token: string): Promise<VerifiedAuthUser | null> {
  const secretKey = getClerkSecretKey();
  if (!secretKey) {
    return null;
  }

  try {
    const verifiedToken = await verifyClerkToken(token, { secretKey });
    const userId = verifiedToken?.sub;

    if (!userId || typeof userId !== 'string') {
      return null;
    }

    let appUserId = userId;
    try {
      const linkedUser = await resolveCanonicalClerkLinkedUser(userId);
      if (linkedUser?.id) {
        appUserId = linkedUser.id;
      }
    } catch (mappingError: any) {
      logger.debug('Clerk identity mapping lookup failed', {
        error: mappingError?.message || 'Unknown mapping lookup error'
      });
    }

    return {
      id: appUserId,
      clerkUserId: userId,
      email: typeof verifiedToken?.email === 'string' ? verifiedToken.email : '',
      role: typeof verifiedToken?.role === 'string' ? verifiedToken.role : undefined,
      source: 'clerk'
    };
  } catch (error: any) {
    logger.debug('Clerk access token verification failed', {
      error: error?.message || 'Token verification failed'
    });
    return null;
  }
}

function getVerifiedClerkEmail(emailAddress: any): string | null {
  const value = typeof emailAddress?.emailAddress === 'string'
    ? emailAddress.emailAddress.trim().toLowerCase()
    : '';
  const isVerified = emailAddress?.verification?.status === 'verified';
  return value && isVerified ? value : null;
}

export async function resolveClerkPrimaryEmail(userId: string): Promise<string | null> {
  const secretKey = getClerkSecretKey();
  if (!secretKey || !userId) {
    return null;
  }

  try {
    const clerkClient = createClerkClient({ secretKey });
    const clerkUser = await clerkClient.users.getUser(userId);
    const primaryEmail =
      getVerifiedClerkEmail(clerkUser.primaryEmailAddress) ||
      getVerifiedClerkEmail(clerkUser.emailAddresses.find((emailAddress) => emailAddress.id === clerkUser.primaryEmailAddressId)) ||
      clerkUser.emailAddresses.map(getVerifiedClerkEmail).find(Boolean) ||
      null;

    return primaryEmail;
  } catch (error: any) {
    logger.warn('Failed to resolve Clerk user email during bootstrap', {
      userId,
      error: error?.message || 'Unknown Clerk user lookup error'
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
    // Fall through to Clerk, then legacy token verification.
  }

  const clerkUser = await verifyClerkAccessToken(token);
  if (clerkUser) {
    return clerkUser;
  }

  return verifySupabaseAccessToken(token);
}
