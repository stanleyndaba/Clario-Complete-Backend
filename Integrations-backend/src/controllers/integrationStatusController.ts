/**
 * Integration Status Controller
 * Handles GET /api/v1/integrations/status endpoint
 * Returns status of all integrations including evidence providers
 */

import { Request, Response } from 'express';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';

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
      .select('id, slug, name')
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

    // Check Amazon connection for the resolved tenant only.
    try {
      const { data: amazonToken, error: tokenError } = await adminClient
        .from('tokens')
        .select('id, expires_at, updated_at')
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
      } else if (amazonToken && (!amazonToken.expires_at || new Date(amazonToken.expires_at) > new Date())) {
        response.amazon_connected = true;
      }
    } catch (amazonError) {
      logger.debug('Error checking Amazon connection', { error: amazonError });
    }

    // sync_progress is not tenant-scoped in this schema, so we refuse to present it
    // as tenant truth when multiple workspaces may exist for the same user.
    response.lastSync = null;

    // Check evidence sources from database for the resolved tenant only.
    try {
      const { data: evidenceSources, error: sourcesError } = await adminClient
        .from('evidence_sources')
        .select('provider, status, last_sync_at, account_email, permissions, seller_id, display_name, metadata')
        .eq('tenant_id', tenant.id)
        .or(`user_id.eq.${safeUserId},seller_id.eq.${safeUserId},seller_id.eq.${userId}`);

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
      } else if (evidenceSources && evidenceSources.length > 0) {
        const amazonSource = evidenceSources.find(source => source.provider === 'amazon' && source.status === 'connected');
        if (amazonSource) {
          response.amazon_connected = true;
          response.amazon_account = {
            seller_id: amazonSource.seller_id || undefined,
            display_name: amazonSource.display_name || undefined,
            email: amazonSource.account_email || undefined,
            marketplaces: Array.isArray(amazonSource.metadata?.marketplaces)
              ? amazonSource.metadata.marketplaces
              : undefined
          };
        }

        // Check if any non-Amazon evidence source is connected
        const hasConnectedSource = evidenceSources.some(source => source.provider !== 'amazon' && source.status === 'connected');
        response.docs_connected = hasConnectedSource;

        // Get last ingestion time
        const connectedSources = evidenceSources.filter(source => source.provider !== 'amazon' && source.status === 'connected');
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
        for (const source of evidenceSources) {
          const provider = source.provider as keyof typeof response.providerIngest;

          if (provider && provider in response.providerIngest) {
            let scopes: string[] | undefined;
            if (source.permissions) {
              if (typeof source.permissions === 'string') {
                try {
                  scopes = JSON.parse(source.permissions);
                } catch {
                  scopes = undefined;
                }
              } else if (Array.isArray(source.permissions)) {
                scopes = source.permissions;
              }
            }
            
            response.providerIngest[provider] = {
              connected: source.status === 'connected',
              lastIngest: source.last_sync_at || undefined,
              scopes: scopes,
              email: source.account_email || undefined
            };
          }
        }
      }
    } catch (evidenceError) {
      logger.warn('Failed to check evidence sources', { error: evidenceError });
    }

    // Fallback: if Amazon is connected via tenant-scoped tokens but no Amazon
    // evidence_source exists, derive account identity from the tenant-bound user row.
    if (response.amazon_connected && !response.amazon_account) {
      try {
        const { data: tenantUser, error: tenantUserError } = await adminClient
          .from('users')
          .select('amazon_seller_id, seller_id, company_name, email')
          .eq('id', safeUserId)
          .eq('tenant_id', tenant.id)
          .maybeSingle();

        if (!tenantUserError && tenantUser) {
          response.amazon_account = {
            seller_id: tenantUser.amazon_seller_id || tenantUser.seller_id || undefined,
            display_name: tenantUser.company_name || undefined,
            email: tenantUser.email || undefined
          };
        }
      } catch (tenantUserLookupError) {
        logger.warn('Failed to derive Amazon account identity from tenant-bound user row', {
          error: tenantUserLookupError,
          userId,
          tenantId: tenant.id,
          tenantSlug
        });
      }
    }

    // Token fallback must remain tenant-scoped. We only accept rows explicitly bound
    // to the resolved tenant and refuse user-global fallback here.
    const docProviders = ['gmail', 'outlook', 'gdrive', 'dropbox', 'slack', 'adobe_sign', 'onedrive'] as const;
    for (const provider of docProviders) {
      if (!response.providerIngest[provider].connected) {
        try {
          const { data: tokenRecord, error: tokenError } = await adminClient
            .from('tokens')
            .select('expires_at')
            .eq('user_id', safeUserId)
            .eq('provider', provider)
            .eq('tenant_id', tenant.id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (tokenError && tokenError.code !== 'PGRST116') {
            const isTenantColumnIssue = tokenError.code === 'PGRST204' ||
              tokenError.message?.includes('tenant_id') ||
              tokenError.message?.includes('does not exist');
            if (!isTenantColumnIssue) {
              throw tokenError;
            }
          }

          if (tokenRecord) {
            const isExpired = new Date(tokenRecord.expires_at) <= new Date();
            if (!isExpired) {
              response.providerIngest[provider].connected = true;
              response.docs_connected = true;
              logger.info(`Detected ${provider} connection via tenant-scoped token fallback`, {
                userId,
                tenantId: tenant.id,
                tenantSlug
              });
            }
          }
        } catch (tokenError) {
          logger.debug(`${provider} status check fallback failed`, { error: tokenError });
        }
      }
    }

    response.agent2_ready = response.amazon_connected;

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

