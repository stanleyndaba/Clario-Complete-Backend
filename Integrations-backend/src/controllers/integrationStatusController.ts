/**
 * Integration Status Controller
 * Handles GET /api/v1/integrations/status endpoint
 * Returns status of all integrations including evidence providers
 */

import { Request, Response } from 'express';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';

type ProviderKey = 'amazon' | 'gmail' | 'outlook' | 'gdrive' | 'dropbox' | 'slack' | 'adobe_sign' | 'onedrive';
const DOC_TOKEN_PROVIDERS: ProviderKey[] = ['gmail', 'outlook', 'gdrive', 'dropbox'];

interface EvidenceFilters {
  senderPatterns: string[];
  excludeSenders: string[];
  subjectKeywords: string[];
  excludeSubjects: string[];
  fileTypes: { pdf: boolean; images: boolean; spreadsheets: boolean; docs: boolean; shipping: boolean };
  fileNamePatterns: string[];
  folders: string[];
  dateRange: 'last_30' | 'last_90' | 'last_12_months' | 'last_18_months' | 'since_last_sync' | 'all';
  skipDuplicates: boolean;
  skipExisting: boolean;
}

interface ProviderStatus {
  provider: ProviderKey;
  source_id?: string;
  connected: boolean;
  auth_valid: boolean;
  needs_reconnect: boolean;
  last_ingest_at?: string;
  last_success_at?: string;
  error_state?: string;
  error_message?: string;
  ingestion_state: 'disconnected' | 'unverified' | 'no_data' | 'stale' | 'current' | 'failed';
  has_data: boolean;
  account_email?: string;
  scopes?: string[];
  token_present?: boolean;
  token_not_expired?: boolean;
  tenant_bound?: boolean;
  seller_resolved?: boolean;
  store_bound?: boolean;
  connection_truth_basis?: 'stored_token_and_binding';
}

const DEFAULT_FILTERS: EvidenceFilters = {
  senderPatterns: [
    '*@fedex.com', '*@ups.com', '*@dhl.com', '*@usps.com', '*@ontrac.com', '*@freight*',
    '*@amazon.com', '*@sellercentral.amazon.*', '*@payments.amazon.com',
    '*@shipstation.com', '*@shipbob.com', '*@easyship.com', '*@flexport.com', '*@deliverr.com',
    '*invoice*', '*billing*', '*accounts*', '*finance*'
  ],
  excludeSenders: ['*newsletter*', '*marketing*', '*promo*', '*noreply*advertising*', '*survey*'],
  subjectKeywords: [
    'invoice', 'tax invoice', 'proforma', 'receipt', 'PO', 'purchase order', 'packing slip', 'commercial invoice', 'vendor invoice', 'supplier',
    'bill of lading', 'BOL', 'waybill', 'tracking', 'shipment', 'dispatch', 'airwaybill', 'AWB', 'freight', 'manifest', 'booking confirmation', 'carrier',
    'POD', 'proof of delivery', 'delivery confirmation', 'signed', 'delivered', 'received',
    'return authorization', 'RMA', 'return label', 'return confirmed', 'refund issued', 'credit note', 'credit memo', 'refund', 'return request',
    'ASN', 'advance shipment notice', 'packing list', 'shipment summary', 'inventory', 'pick list', 'pack slip',
    'reimbursement', 'case', 'FBA', 'removal order', 'liquidation'
  ],
  excludeSubjects: ['unsubscribe', 'promotional', 'survey', 'feedback request', 'rate your'],
  fileTypes: { pdf: true, images: true, spreadsheets: true, docs: false, shipping: true },
  fileNamePatterns: [
    'invoice', 'inv-', 'inv_', 'receipt', 'tax-invoice', 'purchase-order', 'po-', 'po_', 'packing-slip', 'commercial-invoice', 'proforma',
    'bol', 'bill-of-lading', 'waybill', 'awb', 'tracking', 'manifest', 'shipment', 'freight', 'dispatch', 'booking',
    'pod', 'proof-of-delivery', 'delivery', 'signed', 'confirmation',
    'rma', 'return', 'credit-note', 'credit-memo', 'refund',
    'asn', 'packing-list', 'pack-list', 'pick-list', 'inventory',
    'FBA', 'reimburse', 'removal', 'liquidation', 'order'
  ],
  folders: ['/Invoices', '/Shipping', '/Returns', '/Credits', '/Amazon', '/Finance', '/Inventory'],
  dateRange: 'last_18_months',
  skipDuplicates: true,
  skipExisting: true
};

function parseScopes(permissions: any): string[] | undefined {
  if (!permissions) return undefined;
  if (Array.isArray(permissions)) return permissions;
  if (typeof permissions === 'string') {
    try {
      const parsed = JSON.parse(permissions);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseExpiry(source: any): Date | null {
  const raw = source?.metadata?.expires_at || source?.metadata?.token_expires_at;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeIngestionState(connected: boolean, authValid: boolean, hasData: boolean, lastIngestAt?: string, sourceStatus?: string, errorMessage?: string): ProviderStatus['ingestion_state'] {
  if (!connected) return 'disconnected';
  if (sourceStatus === 'error' || errorMessage) return 'failed';
  if (!authValid) return 'unverified';
  if (!lastIngestAt && !hasData) return 'unverified';
  if (!hasData) return 'no_data';
  if (!lastIngestAt) return 'current';

  const lastIngest = new Date(lastIngestAt);
  if (Number.isNaN(lastIngest.getTime())) return 'current';

  const ageMs = Date.now() - lastIngest.getTime();
  const staleThresholdMs = 7 * 24 * 60 * 60 * 1000;
  return ageMs > staleThresholdMs ? 'stale' : 'current';
}

function isProductEvidenceSource(source: {
  metadata?: any;
  account_email?: string | null;
}) {
  return source.metadata?.test !== true && source.account_email !== 'unknown@placeholder.invalid';
}

/**
 * Get integration status with evidence providers
 * GET /api/v1/integrations/status
 */
export const getIntegrationStatus = async (req: Request, res: Response) => {
  try {
    // Support both userIdMiddleware and auth middleware
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    const tenantSlug = ((req.query.tenantSlug as string) || (req.query.tenant_slug as string) || '').trim();
    const adminClient = supabaseAdmin || supabase;
    
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required'
      });
    }

    if (!tenantSlug) {
      return res.status(400).json({
        ok: false,
        error: 'tenantSlug is required'
      });
    }

    const safeUserId = convertUserIdToUuid(userId);

    const { data: tenant, error: tenantError } = await adminClient
      .from('tenants')
      .select('id, slug, name, settings')
      .eq('slug', tenantSlug)
      .is('deleted_at', null)
      .maybeSingle();

    if (tenantError) {
      logger.error('Failed to resolve tenant for integration status', {
        error: tenantError,
        userId,
        tenantSlug
      });
      return res.status(500).json({
        ok: false,
        error: 'Failed to resolve tenant context'
      });
    }

    if (!tenant) {
      return res.status(404).json({
        ok: false,
        error: 'Tenant not found'
      });
    }

    const { data: membership, error: membershipError } = await adminClient
      .from('tenant_memberships')
      .select('id, role')
      .eq('tenant_id', tenant.id)
      .eq('user_id', safeUserId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();

    if (membershipError) {
      logger.error('Failed to verify tenant membership for integration status', {
        error: membershipError,
        userId,
        tenantId: tenant.id,
        tenantSlug
      });
      return res.status(500).json({
        ok: false,
        error: 'Failed to verify tenant membership'
      });
    }

    if (!membership) {
      return res.status(403).json({
        ok: false,
        error: 'You do not have access to this tenant'
      });
    }

    logger.info('Getting integration status', { userId, tenantId: tenant.id, tenantSlug });

    // Initialize response
    const response: {
      tenantId: string;
      tenantSlug: string;
      tenantName: string;
      amazon_connected: boolean;
      amazon_account: {
        seller_id?: string;
        display_name?: string;
        email?: string;
        marketplaces?: string[];
      } | null;
      agent2_ready: boolean;
      docs_connected: boolean;
      lastSync: string | null;
      lastIngest: string | null;
      evidenceSettings: {
        autoCollect: boolean;
        schedule: string;
        filters: EvidenceFilters;
      };
      providers: Record<ProviderKey, ProviderStatus>;
      providerIngest: {
        gmail: { connected: boolean; lastIngest?: string; scopes?: string[]; email?: string; error?: string };
        outlook: { connected: boolean; lastIngest?: string; scopes?: string[]; email?: string; error?: string };
        gdrive: { connected: boolean; lastIngest?: string; scopes?: string[]; email?: string; error?: string };
        dropbox: { connected: boolean; lastIngest?: string; scopes?: string[]; email?: string; error?: string };
        slack: { connected: boolean; lastIngest?: string; scopes?: string[]; email?: string; error?: string };
        adobe_sign: { connected: boolean; lastIngest?: string; scopes?: string[]; email?: string; error?: string };
        onedrive: { connected: boolean; lastIngest?: string; scopes?: string[]; email?: string; error?: string };
      };
    } = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      amazon_connected: false,
      amazon_account: null,
      agent2_ready: false,
      docs_connected: false,
      lastSync: null,
      lastIngest: null,
      evidenceSettings: {
        autoCollect: tenant.settings?.evidenceIngestion?.autoCollect !== false,
        schedule: tenant.settings?.evidenceIngestion?.schedule || 'daily_0200',
        filters: tenant.settings?.evidenceIngestion?.filters || DEFAULT_FILTERS
      },
      providers: {
        amazon: { provider: 'amazon', connected: false, auth_valid: false, needs_reconnect: false, ingestion_state: 'disconnected', has_data: false },
        gmail: { provider: 'gmail', connected: false, auth_valid: false, needs_reconnect: false, ingestion_state: 'disconnected', has_data: false },
        outlook: { provider: 'outlook', connected: false, auth_valid: false, needs_reconnect: false, ingestion_state: 'disconnected', has_data: false },
        gdrive: { provider: 'gdrive', connected: false, auth_valid: false, needs_reconnect: false, ingestion_state: 'disconnected', has_data: false },
        dropbox: { provider: 'dropbox', connected: false, auth_valid: false, needs_reconnect: false, ingestion_state: 'disconnected', has_data: false },
        slack: { provider: 'slack', connected: false, auth_valid: false, needs_reconnect: false, ingestion_state: 'disconnected', has_data: false },
        adobe_sign: { provider: 'adobe_sign', connected: false, auth_valid: false, needs_reconnect: false, ingestion_state: 'disconnected', has_data: false },
        onedrive: { provider: 'onedrive', connected: false, auth_valid: false, needs_reconnect: false, ingestion_state: 'disconnected', has_data: false }
      },
      providerIngest: {
        gmail: { connected: false },
        outlook: { connected: false },
        gdrive: { connected: false },
        dropbox: { connected: false },
        slack: { connected: false },
        adobe_sign: { connected: false },
        onedrive: { connected: false }
      }
    };

    let amazonTokenPresent = false;
    let amazonTokenNotExpired = false;
    let amazonTenantBound = false;
    let amazonSellerResolved = false;
    let amazonStoreBound = false;
    let amazonStoreId: string | null = null;
    let amazonConnectionErrorMessage: string | undefined;

    // Check Amazon connection for the resolved tenant only.
    try {
      const { data: amazonToken, error: tokenError } = await adminClient
        .from('tokens')
        .select('id, tenant_id, store_id, expires_at, updated_at')
        .eq('user_id', safeUserId)
        .eq('provider', 'amazon')
        .eq('tenant_id', tenant.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tokenError && tokenError.code !== 'PGRST116') {
        const isTenantColumnIssue = tokenError.code === 'PGRST204' ||
          tokenError.message?.includes('tenant_id') ||
          tokenError.message?.includes('does not exist');

        if (isTenantColumnIssue) {
          logger.warn('Tokens table lacks tenant_id support; refusing global fallback for integration status', {
            userId,
            tenantId: tenant.id,
            tenantSlug
          });
        } else {
          throw tokenError;
        }
      } else if (amazonToken) {
        amazonTokenPresent = true;
        amazonTokenNotExpired = !amazonToken.expires_at || new Date(amazonToken.expires_at) > new Date();
        amazonTenantBound = amazonToken.tenant_id === tenant.id;
        amazonStoreId = amazonToken.store_id || null;
        response.providers.amazon.token_present = true;
        response.providers.amazon.token_not_expired = amazonTokenNotExpired;
        response.providers.amazon.tenant_bound = amazonTenantBound;
      }
    } catch (amazonError) {
      logger.debug('Error checking Amazon connection', { error: amazonError });
    }

    // sync_progress is not tenant-scoped in this schema, so we refuse to present it
    // as tenant truth when multiple workspaces may exist for the same user.
    response.lastSync = null;

    // Check evidence sources from database for the resolved tenant only.
    let providerDocumentStats = new Map<string, { count: number; lastDocumentAt?: string }>();
    let evidenceSources: Array<{
      id: string;
      provider: string;
      status: string;
      last_sync_at?: string;
      account_email?: string | null;
      permissions?: any;
      seller_id?: string;
      display_name?: string;
      metadata?: any;
    }> = [];

    try {
      const { data: providerDocuments } = await adminClient
        .from('evidence_documents')
        .select('provider, created_at')
        .eq('tenant_id', tenant.id)
        .eq('user_id', safeUserId);

      for (const doc of providerDocuments || []) {
        const key = (doc.provider || '').toLowerCase();
        if (!key) continue;
        const current = providerDocumentStats.get(key) || { count: 0, lastDocumentAt: undefined };
        current.count += 1;
        if (doc.created_at && (!current.lastDocumentAt || doc.created_at > current.lastDocumentAt)) {
          current.lastDocumentAt = doc.created_at;
        }
        providerDocumentStats.set(key, current);
      }

      const { data: evidenceSourceRows, error: sourcesError } = await adminClient
        .from('evidence_sources')
        .select('id, provider, status, last_sync_at, account_email, permissions, seller_id, display_name, metadata')
        .eq('tenant_id', tenant.id)
        .eq('user_id', safeUserId);

      if (sourcesError) {
        const isTenantColumnIssue = sourcesError.code === 'PGRST204' ||
          sourcesError.message?.includes('tenant_id') ||
          sourcesError.message?.includes('does not exist');

        if (isTenantColumnIssue) {
          logger.warn('evidence_sources lacks tenant_id support; refusing global fallback for integration status', {
            userId,
            tenantId: tenant.id,
            tenantSlug
          });
        } else {
          logger.warn('Failed to fetch evidence sources', { error: sourcesError });
        }
      } else if (evidenceSourceRows && evidenceSourceRows.length > 0) {
        evidenceSources = evidenceSourceRows || [];
        const productEvidenceSources = evidenceSources.filter(isProductEvidenceSource);

        const amazonSource = productEvidenceSources.find(source => source.provider === 'amazon' && source.status === 'connected');
        if (amazonSource) {
          response.amazon_account = {
            seller_id: amazonSource.seller_id || undefined,
            display_name: amazonSource.display_name || undefined,
            email: amazonSource.account_email || undefined,
            marketplaces: Array.isArray(amazonSource.metadata?.marketplaces)
              ? amazonSource.metadata.marketplaces
              : undefined
          };
          response.providers.amazon.source_id = amazonSource.id;
          response.providers.amazon.account_email = amazonSource.account_email || undefined;
        }

        // Check if any non-Amazon evidence source is connected
        const hasConnectedSource = productEvidenceSources.some(source => source.provider !== 'amazon' && source.status === 'connected');
        response.docs_connected = hasConnectedSource;

        // Get last ingestion time
        const connectedSources = productEvidenceSources.filter(source => source.provider !== 'amazon' && source.status === 'connected');
        if (connectedSources.length > 0) {
          const lastIngest = connectedSources
            .map(source => source.last_sync_at)
            .filter(Boolean)
            .sort()
            .reverse()[0];
          
          if (lastIngest) {
            response.lastIngest = lastIngest;
          }
        }

        // Populate provider-specific status
        for (const source of productEvidenceSources) {
          const provider = source.provider as keyof typeof response.providerIngest;
          const providerKey = source.provider as ProviderKey;
          const documentStats = providerDocumentStats.get(source.provider) || providerDocumentStats.get(source.provider.toLowerCase()) || { count: 0 };
          const expiry = parseExpiry(source);
          const authValid = source.status === 'connected' && (!expiry || expiry > new Date());
          const errorMessage = source.metadata?.last_error || source.metadata?.error || undefined;
          const hasData = (documentStats.count || 0) > 0;
          const lastSuccessAt = documentStats.lastDocumentAt || source.last_sync_at || undefined;
          const ingestionState = computeIngestionState(
            source.status === 'connected',
            authValid,
            hasData,
            source.last_sync_at || undefined,
            source.status,
            errorMessage
          );

          if (providerKey in response.providers) {
            response.providers[providerKey] = {
              provider: providerKey,
              source_id: source.id,
              connected: source.status === 'connected',
              auth_valid: authValid,
              needs_reconnect: source.status === 'connected' ? !authValid : source.status === 'error',
              last_ingest_at: source.last_sync_at || undefined,
              last_success_at: lastSuccessAt,
              error_state: source.status === 'error' ? 'provider_error' : (!authValid && source.status === 'connected' ? 'auth_invalid' : undefined),
              error_message: errorMessage,
              ingestion_state: ingestionState,
              has_data: hasData,
              account_email: source.account_email || undefined,
              scopes: parseScopes(source.permissions)
            };
          }

          if (provider && provider in response.providerIngest) {
            const scopes = parseScopes(source.permissions);
            
            response.providerIngest[provider] = {
              connected: source.status === 'connected',
              lastIngest: source.last_sync_at || undefined,
              scopes: scopes,
              email: source.account_email || undefined,
              error: errorMessage
            };
          }
        }
      }
    } catch (evidenceError) {
      logger.warn('Failed to check evidence sources', { error: evidenceError });
    }

    // Recover docs-provider connection truth from tenant-scoped tokens when the
    // bookkeeping row in evidence_sources is missing or stale.
    try {
      const { data: tokenRows, error: tokenError } = await adminClient
        .from('tokens')
        .select('provider, expires_at, updated_at')
        .eq('user_id', safeUserId)
        .eq('tenant_id', tenant.id)
        .in('provider', DOC_TOKEN_PROVIDERS);

      if (tokenError) {
        const isTenantColumnIssue = tokenError.code === 'PGRST204' ||
          tokenError.message?.includes('tenant_id') ||
          tokenError.message?.includes('does not exist');

        if (isTenantColumnIssue) {
          logger.warn('Tokens table lacks tenant_id support; refusing token fallback for docs providers', {
            userId,
            tenantId: tenant.id,
            tenantSlug
          });
        } else {
          logger.warn('Failed to fetch token-backed docs provider status', { error: tokenError });
        }
      } else {
        for (const tokenRow of tokenRows || []) {
          const providerKey = tokenRow.provider as ProviderKey;
          if (!DOC_TOKEN_PROVIDERS.includes(providerKey)) continue;
          if (response.providers[providerKey].connected) continue;

          const expiry = tokenRow.expires_at ? new Date(tokenRow.expires_at) : null;
          const authValid = !expiry || expiry > new Date();
          if (!authValid) continue;

          const existingSource = evidenceSources.find(source => source.provider === providerKey);
          const documentStats = providerDocumentStats.get(providerKey) || { count: 0 };
          const hasData = (documentStats.count || 0) > 0;
          const lastIngestAt = existingSource?.last_sync_at || tokenRow.updated_at || undefined;
          const lastSuccessAt = documentStats.lastDocumentAt || lastIngestAt;
          const accountEmail = existingSource?.account_email && existingSource.account_email !== 'unknown'
            ? existingSource.account_email
            : undefined;

          let sourceId = existingSource?.id;

          if (!sourceId) {
            try {
              const { data: insertedSource, error: insertError } = await adminClient
                .from('evidence_sources')
                .insert({
                  user_id: safeUserId,
                  seller_id: safeUserId,
                  provider: providerKey,
                  account_email: accountEmail || 'unknown',
                  status: 'connected',
                  last_sync_at: lastIngestAt || new Date().toISOString(),
                  permissions: [],
                  metadata: {
                    source: 'token_recovery',
                    token_source: 'integration_status',
                    expires_at: tokenRow.expires_at || null
                  },
                  tenant_id: tenant.id
                })
                .select('id, account_email, last_sync_at')
                .maybeSingle();

              if (insertError) {
                logger.warn('Failed to create evidence source from token-backed connection truth', {
                  error: insertError,
                  userId,
                  tenantId: tenant.id,
                  provider: providerKey
                });
              } else if (insertedSource?.id) {
                sourceId = insertedSource.id;
                evidenceSources.push({
                  id: insertedSource.id,
                  provider: providerKey,
                  status: 'connected',
                  last_sync_at: insertedSource.last_sync_at || lastIngestAt,
                  account_email: insertedSource.account_email || accountEmail || 'unknown',
                  permissions: [],
                  seller_id: safeUserId,
                  metadata: {
                    source: 'token_recovery',
                    token_source: 'integration_status',
                    expires_at: tokenRow.expires_at || null
                  }
                });
              }
            } catch (sourceRecoveryError) {
              logger.warn('Failed to reconcile evidence source from docs-provider token', {
                error: sourceRecoveryError,
                userId,
                tenantId: tenant.id,
                provider: providerKey
              });
            }
          }

          const ingestionState = computeIngestionState(
            true,
            true,
            hasData,
            lastIngestAt,
            'connected',
            undefined
          );

          response.providers[providerKey] = {
            provider: providerKey,
            source_id: sourceId,
            connected: true,
            auth_valid: true,
            needs_reconnect: false,
            last_ingest_at: lastIngestAt,
            last_success_at: lastSuccessAt,
            ingestion_state: ingestionState,
            has_data: hasData,
            account_email: accountEmail,
            scopes: response.providers[providerKey].scopes
          };

          response.providerIngest[providerKey] = {
            connected: true,
            lastIngest: lastIngestAt,
            scopes: response.providers[providerKey].scopes,
            email: accountEmail
          };
        }
      }
    } catch (tokenFallbackError) {
      logger.warn('Failed to reconcile docs providers from tokens', { error: tokenFallbackError });
    }

    try {
      const { data: tenantUser, error: tenantUserError } = await adminClient
        .from('users')
        .select('amazon_seller_id, seller_id, company_name, email')
        .eq('id', safeUserId)
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      if (!tenantUserError && tenantUser) {
        amazonSellerResolved = !!(tenantUser.amazon_seller_id || tenantUser.seller_id);
        response.providers.amazon.seller_resolved = amazonSellerResolved;

        if (!response.amazon_account) {
          response.amazon_account = {
            seller_id: tenantUser.amazon_seller_id || tenantUser.seller_id || undefined,
            display_name: tenantUser.company_name || undefined,
            email: tenantUser.email || undefined
          };
        }
      }
    } catch (tenantUserLookupError) {
      logger.warn('Failed to derive Amazon account identity from tenant-bound user row', {
        error: tenantUserLookupError,
        userId,
        tenantId: tenant.id,
        tenantSlug
      });
    }

    if (amazonStoreId) {
      try {
        const { data: storeRow, error: storeError } = await adminClient
          .from('stores')
          .select('id, seller_id, marketplace')
          .eq('id', amazonStoreId)
          .eq('tenant_id', tenant.id)
          .is('deleted_at', null)
          .maybeSingle();

        if (!storeError && storeRow?.id) {
          amazonStoreBound = true;
          response.providers.amazon.store_bound = true;

          if (!response.amazon_account?.seller_id && storeRow.seller_id) {
            response.amazon_account = {
              seller_id: storeRow.seller_id,
              display_name: response.amazon_account?.display_name,
              email: response.amazon_account?.email
            };
          }
        }
      } catch (storeLookupError) {
        logger.warn('Failed to validate Amazon store binding for integration status', {
          error: storeLookupError,
          userId,
          tenantId: tenant.id,
          tenantSlug,
          storeId: amazonStoreId
        });
      }
    }

    const connectedNonAmazonProviders = (Object.entries(response.providers) as Array<[ProviderKey, ProviderStatus]>)
      .filter(([provider]) => provider !== 'amazon' && response.providers[provider].connected);
    response.docs_connected = connectedNonAmazonProviders.length > 0;

    const amazonConnectionReady =
      amazonTokenPresent &&
      amazonTokenNotExpired &&
      amazonTenantBound &&
      amazonSellerResolved &&
      amazonStoreBound;

    if (!amazonTokenPresent) {
      amazonConnectionErrorMessage = undefined;
    } else if (!amazonTokenNotExpired) {
      amazonConnectionErrorMessage = 'Amazon token is expired and must be refreshed through reconnect.';
    } else if (!amazonTenantBound) {
      amazonConnectionErrorMessage = 'Amazon token is not bound to the active tenant.';
    } else if (!amazonSellerResolved) {
      amazonConnectionErrorMessage = 'Amazon seller identity is not resolved on the authenticated app user.';
    } else if (!amazonStoreBound) {
      amazonConnectionErrorMessage = 'Amazon token is not bound to a valid store.';
    }

    response.amazon_connected = amazonConnectionReady;
    response.providers.amazon.connected = amazonConnectionReady;
    response.providers.amazon.auth_valid = amazonConnectionReady;
    response.providers.amazon.needs_reconnect = amazonTokenPresent && !amazonTokenNotExpired;
    response.providers.amazon.token_present = amazonTokenPresent;
    response.providers.amazon.token_not_expired = amazonTokenNotExpired;
    response.providers.amazon.tenant_bound = amazonTenantBound;
    response.providers.amazon.seller_resolved = amazonSellerResolved;
    response.providers.amazon.store_bound = amazonStoreBound;
    response.providers.amazon.connection_truth_basis = 'stored_token_and_binding';
    response.providers.amazon.error_message = amazonConnectionErrorMessage || response.providers.amazon.error_message;
    response.providers.amazon.error_state = !amazonConnectionReady && amazonConnectionErrorMessage
      ? (amazonTokenPresent && !amazonTokenNotExpired ? 'auth_invalid' : 'provider_error')
      : response.providers.amazon.error_state;
    response.providers.amazon.ingestion_state = computeIngestionState(
      response.providers.amazon.connected,
      response.providers.amazon.auth_valid,
      response.providers.amazon.has_data,
      response.providers.amazon.last_ingest_at,
      response.providers.amazon.error_state === 'provider_error' ? 'error' : undefined,
      response.providers.amazon.error_message
    );

    response.agent2_ready = amazonConnectionReady;

    logger.info('Integration status retrieved', {
      userId,
      tenantId: tenant.id,
      tenantSlug,
      amazon_connected: response.amazon_connected,
      agent2_ready: response.agent2_ready,
      docs_connected: response.docs_connected,
      providers_connected: Object.values(response.providerIngest).filter(p => p.connected).length
    });

    res.json(response);
  } catch (error: any) {
    logger.error('Error getting integration status', {
      error: error?.message || String(error),
      stack: error?.stack
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to get integration status'
    });
  }
};

