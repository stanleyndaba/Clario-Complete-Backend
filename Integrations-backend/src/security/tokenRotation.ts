/**
 * Token Rotation Utility
 * 
 * Implements secure token rotation with old token invalidation
 */

import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';

export interface TokenRotationResult {
  success: boolean;
  newRefreshToken?: string;
  oldTokenInvalidated?: boolean;
  error?: string;
}

/**
 * Rotate refresh token - invalidate old token and store new one
 */
export async function rotateRefreshToken(
  userId: string,
  provider: string,
  oldRefreshToken: string,
  newRefreshToken: string
): Promise<TokenRotationResult> {
  try {
    // Verify old token exists and belongs to user
    const { data: existingToken, error: fetchError } = await supabase
      .from('oauth_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('refresh_token', oldRefreshToken)
      .single();

    if (fetchError || !existingToken) {
      logger.warn('Token rotation: Old token not found or invalid', {
        userId,
        provider,
        error: fetchError?.message,
      });

      // Log security event
      await logTokenEvent({
        event: 'token_rotation_failed',
        userId,
        provider,
        reason: 'old_token_not_found',
      });

      return {
        success: false,
        error: 'Old token not found or invalid',
      };
    }

    // Check if token was already used (prevent replay attacks)
    if (existingToken.rotated_at) {
      logger.warn('Token rotation: Token already rotated (possible replay attack)', {
        userId,
        provider,
        oldTokenId: existingToken.id,
        rotatedAt: existingToken.rotated_at,
      });

      // Log security event
      await logTokenEvent({
        event: 'token_reuse_detected',
        userId,
        provider,
        reason: 'token_already_rotated',
      });

      return {
        success: false,
        error: 'Token has already been rotated',
      };
    }

    // Update token: set new refresh token and mark old one as rotated
    const { error: updateError } = await supabase
      .from('oauth_tokens')
      .update({
        refresh_token: newRefreshToken,
        rotated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingToken.id);

    if (updateError) {
      logger.error('Token rotation: Failed to update token', {
        userId,
        provider,
        error: updateError.message,
      });

      return {
        success: false,
        error: 'Failed to rotate token',
      };
    }

    // Log successful rotation
    await logTokenEvent({
      event: 'token_rotated',
      userId,
      provider,
      tokenId: existingToken.id,
    });

    logger.info('Token rotation: Successfully rotated token', {
      userId,
      provider,
      tokenId: existingToken.id,
    });

    return {
      success: true,
      newRefreshToken,
      oldTokenInvalidated: true,
    };
  } catch (error: any) {
    logger.error('Token rotation: Unexpected error', {
      userId,
      provider,
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      error: 'Unexpected error during token rotation',
    };
  }
}

/**
 * Check if a token has been rotated (prevent reuse)
 */
export async function isTokenRotated(
  userId: string,
  provider: string,
  refreshToken: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('rotated_at')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('refresh_token', refreshToken)
      .single();

    if (error || !data) {
      return false;
    }

    return !!data.rotated_at;
  } catch (error) {
    logger.error('Error checking token rotation status', { error });
    return false;
  }
}

/**
 * Invalidate a token (mark as revoked)
 */
export async function invalidateToken(
  userId: string,
  provider: string,
  refreshToken: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('oauth_tokens')
      .update({
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('refresh_token', refreshToken);

    if (error) {
      logger.error('Failed to invalidate token', {
        userId,
        provider,
        error: error.message,
      });
      return false;
    }

    // Log security event
    await logTokenEvent({
      event: 'token_invalidated',
      userId,
      provider,
    });

    return true;
  } catch (error: any) {
    logger.error('Error invalidating token', {
      userId,
      provider,
      error: error.message,
    });
    return false;
  }
}

/**
 * Log token events for audit trail
 */
async function logTokenEvent(event: {
  event: string;
  userId: string;
  provider: string;
  tokenId?: string;
  reason?: string;
}): Promise<void> {
  try {
    // Log to audit table
    const { error } = await supabase.from('audit_logs').insert({
      event_type: event.event,
      user_id: event.userId,
      provider: event.provider,
      metadata: {
        tokenId: event.tokenId,
        reason: event.reason,
      },
      created_at: new Date().toISOString(),
    });

    if (error) {
      logger.error('Failed to log token event', {
        error: error.message,
        event,
      });
    }

    // Also log to application logs
    logger.info('Token event', event);
  } catch (error: any) {
    logger.error('Error logging token event', {
      error: error.message,
      event,
    });
  }
}

/**
 * Check for token reuse (security alert)
 */
export async function checkTokenReuse(
  userId: string,
  provider: string,
  refreshToken: string
): Promise<{ reused: boolean; alert?: string }> {
  try {
    // Check if token was already rotated
    const isRotated = await isTokenRotated(userId, provider, refreshToken);
    if (isRotated) {
      // Alert on token reuse
      await logTokenEvent({
        event: 'token_reuse_alert',
        userId,
        provider,
        reason: 'attempted_use_of_rotated_token',
      });

      return {
        reused: true,
        alert: 'Token reuse detected - possible security breach',
      };
    }

    return { reused: false };
  } catch (error: any) {
    logger.error('Error checking token reuse', {
      userId,
      provider,
      error: error.message,
    });
    return { reused: false };
  }
}

