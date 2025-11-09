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
        dropbox: { connected: false }
      }
    };

    // Check Amazon connection
    try {
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
      }
    } catch (amazonError) {
      logger.debug('Amazon not connected', { error: amazonError });
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

    // Also check token manager for evidence providers (fallback)
    const evidenceProviders = ['gmail', 'outlook', 'gdrive', 'dropbox'];
    for (const provider of evidenceProviders) {
      if (!response.providerIngest[provider as keyof typeof response.providerIngest].connected) {
        try {
          const token = await tokenManager.getToken(userId, provider);
          if (token && token.accessToken) {
            response.providerIngest[provider as keyof typeof response.providerIngest].connected = true;
            response.docs_connected = true;
            
            // Try to get last sync from evidence_sources
            try {
              const { data: source } = await supabase
                .from('evidence_sources')
                .select('last_sync_at')
                .eq('user_id', userId)
                .eq('provider', provider)
                .eq('status', 'connected')
                .maybeSingle();
              
              if (source?.last_sync_at) {
                response.providerIngest[provider as keyof typeof response.providerIngest].lastIngest = source.last_sync_at;
              }
            } catch (dbError) {
              logger.debug('Failed to get last sync from database', { provider, error: dbError });
            }
          }
        } catch (tokenError) {
          // Provider not connected, that's okay
          logger.debug(`Provider ${provider} not connected`, { error: tokenError });
        }
      }
    }

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

