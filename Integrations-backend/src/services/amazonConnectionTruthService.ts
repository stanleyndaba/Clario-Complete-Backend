import { convertUserIdToUuid, supabase, supabaseAdmin } from '../database/supabaseClient';
import { normalizeResolvedAmazonSellerId } from '../utils/sellerIdentity';
import logger from '../utils/logger';

export type AmazonConnectionTruthErrorCode =
  | 'amazon_token_expired'
  | 'amazon_token_not_bound_to_tenant'
  | 'amazon_seller_identity_unresolved'
  | 'amazon_store_binding_invalid'
  | null;

export interface AmazonConnectionTruth {
  connected: boolean;
  needsReconnect: boolean;
  tokenPresent: boolean;
  tokenNotExpired: boolean;
  tenantBound: boolean;
  sellerResolved: boolean;
  storeBound: boolean;
  storeId: string | null;
  errorCode: AmazonConnectionTruthErrorCode;
  errorMessage: string | null;
  errorState: 'auth_invalid' | 'provider_error' | null;
}

function buildConnectionTruth(params: {
  tokenPresent: boolean;
  tokenNotExpired: boolean;
  tenantBound: boolean;
  sellerResolved: boolean;
  storeBound: boolean;
  storeId: string | null;
}): AmazonConnectionTruth {
  const connected =
    params.tokenPresent &&
    params.tokenNotExpired &&
    params.tenantBound &&
    params.sellerResolved &&
    params.storeBound;

  let errorCode: AmazonConnectionTruthErrorCode = null;
  let errorMessage: string | null = null;

  if (!params.tokenPresent) {
    errorCode = null;
  } else if (!params.tokenNotExpired) {
    errorCode = 'amazon_token_expired';
    errorMessage = 'Amazon token is expired and must be refreshed through reconnect.';
  } else if (!params.tenantBound) {
    errorCode = 'amazon_token_not_bound_to_tenant';
    errorMessage = 'Amazon token is not bound to the active tenant.';
  } else if (!params.sellerResolved) {
    errorCode = 'amazon_seller_identity_unresolved';
    errorMessage = 'Amazon seller identity is not resolved on the authenticated app user.';
  } else if (!params.storeBound) {
    errorCode = 'amazon_store_binding_invalid';
    errorMessage = 'Amazon token is not bound to a valid store.';
  }

  return {
    connected,
    needsReconnect: params.tokenPresent && !params.tokenNotExpired,
    tokenPresent: params.tokenPresent,
    tokenNotExpired: params.tokenNotExpired,
    tenantBound: params.tenantBound,
    sellerResolved: params.sellerResolved,
    storeBound: params.storeBound,
    storeId: params.storeId,
    errorCode,
    errorMessage,
    errorState: !connected && errorMessage
      ? (params.tokenPresent && !params.tokenNotExpired ? 'auth_invalid' : 'provider_error')
      : null,
  };
}

/**
 * Resolves Amazon connection truth for an already authenticated user and
 * already authorized tenant. This deliberately mirrors the integration-status
 * contract: a token alone is never sufficient to report a connected account.
 */
export async function getAuthoritativeAmazonConnectionTruth(input: {
  userId: string;
  tenantId: string;
}): Promise<AmazonConnectionTruth> {
  const db = supabaseAdmin || supabase;
  const safeUserId = convertUserIdToUuid(input.userId);

  let tokenPresent = false;
  let tokenNotExpired = false;
  let tenantBound = false;
  let sellerResolved = false;
  let storeBound = false;
  let storeId: string | null = null;

  try {
    const { data: amazonToken, error: tokenError } = await db
      .from('tokens')
      .select('id, tenant_id, store_id, expires_at, updated_at')
      .eq('user_id', safeUserId)
      .eq('provider', 'amazon')
      .eq('tenant_id', input.tenantId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenError && tokenError.code !== 'PGRST116') {
      const isTenantColumnIssue = tokenError.code === 'PGRST204' ||
        tokenError.message?.includes('tenant_id') ||
        tokenError.message?.includes('does not exist');

      if (isTenantColumnIssue) {
        logger.warn('Tokens table lacks tenant_id support; refusing global fallback for Amazon connection truth', {
          userId: input.userId,
          tenantId: input.tenantId,
        });
      } else {
        throw tokenError;
      }
    } else if (amazonToken) {
      tokenPresent = true;
      tokenNotExpired = !amazonToken.expires_at || new Date(amazonToken.expires_at) > new Date();
      tenantBound = amazonToken.tenant_id === input.tenantId;
      storeId = amazonToken.store_id || null;
    }
  } catch (error) {
    logger.debug('Error checking Amazon connection', { error });
  }

  try {
    const { data: tenantUser, error: tenantUserError } = await db
      .from('users')
      .select('amazon_seller_id, seller_id')
      .eq('id', safeUserId)
      .eq('tenant_id', input.tenantId)
      .maybeSingle();

    if (!tenantUserError && tenantUser) {
      sellerResolved = Boolean(normalizeResolvedAmazonSellerId(
        tenantUser.amazon_seller_id,
        tenantUser.seller_id,
      ));
    }
  } catch (error) {
    logger.warn('Failed to derive Amazon account identity from tenant-bound user row', {
      error,
      userId: input.userId,
      tenantId: input.tenantId,
    });
  }

  if (storeId) {
    try {
      const { data: storeRow, error: storeError } = await db
        .from('stores')
        .select('id')
        .eq('id', storeId)
        .eq('tenant_id', input.tenantId)
        .is('deleted_at', null)
        .maybeSingle();

      if (!storeError && storeRow?.id) {
        storeBound = true;
      }
    } catch (error) {
      logger.warn('Failed to validate Amazon store binding for connection truth', {
        error,
        userId: input.userId,
        tenantId: input.tenantId,
        storeId,
      });
    }
  }

  return buildConnectionTruth({
    tokenPresent,
    tokenNotExpired,
    tenantBound,
    sellerResolved,
    storeBound,
    storeId,
  });
}

export function toAmazonLifecycleStatus(truth: AmazonConnectionTruth):
  'connected' | 'connection_required' | 'reconnect_required' | 'unavailable' | 'error' {
  if (truth.connected) return 'connected';
  if (truth.needsReconnect) return 'reconnect_required';
  if (!truth.tokenPresent) return 'connection_required';
  return truth.errorState === 'provider_error' ? 'error' : 'unavailable';
}
