/**
 * Integration Status Controller
 * Handles GET /api/v1/integrations/status endpoint
 * Returns status of all integrations including evidence providers
 */

import { Request, Response } from 'express';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { supabase } from '../database/supabaseClient';
import { gmailIngestionService } from '../services/gmailIngestionService';

/**
 * Get integration status with evidence providers
 * GET /api/v1/integrations/status
 */
export const getIntegrationStatus = async (req: Request, res: Response) => {
  try {
    // Support both userIdMiddleware and auth middleware
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required'
      });
    }

    logger.info('Getting integration status', { userId });

    // Initialize response
    const response: {
      amazon_connected: boolean;
      docs_connected: boolean;
      lastSync: string | null;
      lastIngest: string | null;
      providerIngest: {
        gmail: { connected: boolean; lastIngest?: string; scopes?: string[]; error?: string };
        outlook: { connected: boolean; lastIngest?: string; scopes?: string[]; error?: string };
        gdrive: { connected: boolean; lastIngest?: string; scopes?: string[]; error?: string };
        dropbox: { connected: boolean; lastIngest?: string; scopes?: string[]; error?: string };
        slack: { connected: boolean; lastIngest?: string; scopes?: string[]; error?: string };
        adobe_sign: { connected: boolean; lastIngest?: string; scopes?: string[]; error?: string };
        onedrive: { connected: boolean; lastIngest?: string; scopes?: string[]; error?: string };
      };
    } = {
      amazon_connected: false,
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

    // Check Amazon connection
    // In sandbox mode, Amazon connection can be via:
    // 1. Token stored in database (tokenManager)
    // 2. Refresh token in environment variables (AMAZON_SPAPI_REFRESH_TOKEN)
    // 3. Token in environment variables (for testing/sandbox)
    try {
      // First, try to get token from tokenManager (database)
      const amazonToken = await tokenManager.getToken(userId, 'amazon');
      if (amazonToken && amazonToken.accessToken) {
        response.amazon_connected = true;
        
        // Get last sync from sync_progress table
        try {
          const { data: lastSync } = await supabase
            .from('sync_progress')
            .select('updated_at')
            .eq('user_id', userId)
            .eq('status', 'completed')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (lastSync?.updated_at) {
            response.lastSync = lastSync.updated_at;
          }
        } catch (syncError) {
          logger.debug('Failed to get last sync time', { error: syncError });
        }
      } else {
        // If no token in database, check environment variables (sandbox mode)
        // This is common in sandbox/testing where refresh token is in env vars
        const envRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
        const envClientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
        const envClientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
        
        // If we have refresh token and credentials in environment, Amazon is "connected"
        // This is the typical sandbox setup
        if (envRefreshToken && envRefreshToken.trim() !== '' && envClientId && envClientSecret) {
          response.amazon_connected = true;
          logger.info('Amazon connection detected via environment variables (sandbox mode)', {
            userId,
            hasRefreshToken: !!envRefreshToken,
            hasClientId: !!envClientId,
            hasClientSecret: !!envClientSecret
          });
          
          // Try to get last sync from sync_progress table
          try {
            const { data: lastSync } = await supabase
              .from('sync_progress')
              .select('updated_at')
              .eq('user_id', userId)
              .eq('status', 'completed')
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (lastSync?.updated_at) {
              response.lastSync = lastSync.updated_at;
            }
          } catch (syncError) {
            logger.debug('Failed to get last sync time', { error: syncError });
          }
        } else {
          logger.debug('Amazon not connected - no token in database or environment', {
            userId,
            hasDbToken: !!amazonToken,
            hasEnvRefreshToken: !!envRefreshToken,
            hasEnvClientId: !!envClientId,
            hasEnvClientSecret: !!envClientSecret
          });
        }
      }
    } catch (amazonError) {
      logger.debug('Error checking Amazon connection', { error: amazonError });
      // Don't set amazon_connected to true if there's an error
    }

    // Check evidence sources from database
    try {
      const { data: evidenceSources, error: sourcesError } = await supabase
        .from('evidence_sources')
        .select('provider, status, last_sync_at, account_email, permissions')
        .eq('user_id', userId);

      if (sourcesError) {
        logger.warn('Failed to fetch evidence sources', { error: sourcesError });
      } else if (evidenceSources && evidenceSources.length > 0) {
        // Check if any evidence source is connected
        const hasConnectedSource = evidenceSources.some(source => source.status === 'connected');
        response.docs_connected = hasConnectedSource;

        // Get last ingestion time
        const connectedSources = evidenceSources.filter(source => source.status === 'connected');
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
          const provider = source.provider as 'gmail' | 'outlook' | 'gdrive' | 'dropbox';
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
              scopes: scopes
            };
          }
        }
      }
    } catch (evidenceError) {
      logger.warn('Failed to check evidence sources', { error: evidenceError });
    }

    // Also check token manager for Gmail/Outlook/Drive/Dropbox (fallback)
    const docProviders = ['gmail', 'outlook', 'gdrive', 'dropbox'] as const;
    for (const provider of docProviders) {
      if (!response.providerIngest[provider].connected) {
        try {
          // Check for ANY token for this provider (ignoring storeId)
          // We'll use a specific query here to find any valid token
          const { data: tokenRecord } = await supabase
            .from('tokens')
            .select('access_token_data, expires_at')
            .eq('user_id', userId)
            .eq('provider', provider)
            .limit(1)
            .maybeSingle();

          if (tokenRecord && tokenRecord.access_token_data) {
            // Check expiry
            const isExpired = new Date(tokenRecord.expires_at) <= new Date();
            if (!isExpired) {
              response.providerIngest[provider].connected = true;
              response.docs_connected = true;
              logger.info(`Detected ${provider} connection via global token fallback`, { userId });
            }
          }
        } catch (tokenError) {
          logger.debug(`${provider} status check fallback failed`, { error: tokenError });
        }
      }
    }
    
    // For other providers (outlook, gdrive, dropbox), connection status is already
    // checked from the evidence_sources database query above

    logger.info('Integration status retrieved', {
      userId,
      amazon_connected: response.amazon_connected,
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

