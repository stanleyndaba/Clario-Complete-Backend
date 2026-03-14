import { Request, Response } from 'express';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { supabase } from '../database/supabaseClient';

/**
 * Disconnect evidence source provider
 */
async function disconnectEvidenceSource(req: Request, res: Response, provider: string) {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required'
      });
    }

    // Revoke token from token manager (only for supported providers)
    if (provider === 'gmail') {
      try {
        await tokenManager.revokeToken(userId, 'gmail');
        logger.info('Evidence source token revoked', { userId, provider });
      } catch (error) {
        logger.warn('Failed to revoke evidence source token', { error, provider });
      }
    } else {
      // For other providers, tokens are stored in database metadata
      // The database update below will handle the status change
      logger.info('Evidence source token revoke skipped (stored in database)', { userId, provider });
    }

    // Update evidence_sources status to disconnected
    try {
      await supabase
        .from('evidence_sources')
        .update({ 
          status: 'disconnected', 
          updated_at: new Date().toISOString() 
        })
        .eq('user_id', userId)
        .eq('provider', provider);
    } catch (dbError) {
      logger.warn('Failed to update evidence_sources status', { error: dbError, provider });
    }

    logger.info('Evidence source disconnected', { userId, provider });

    res.json({
      ok: true,
      message: `${provider} disconnected successfully`
    });
  } catch (error: any) {
    logger.error('Evidence source disconnect error', { error, provider });
    res.status(500).json({
      ok: false,
      error: 'Failed to disconnect evidence source'
    });
  }
}

export const getIntegrationStatus = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    logger.info('Getting provider status', { userId, provider });

    // Handle Amazon provider specifically (Agent 1)
    if (provider === 'amazon') {
      let connected = false;
      let sandboxMode = false;
      let useMockGenerator = false;
      let lastSync: string | null = null;
      let connectionVerified = false;

      try {
        // Check if Amazon token exists in database
        const amazonToken = await tokenManager.getToken(userId, 'amazon');
        
        if (amazonToken && amazonToken.accessToken) {
          connected = true;
          connectionVerified = true;
          
          // Check sandbox mode
          const spapiUrl = process.env.AMAZON_SPAPI_BASE_URL || '';
          sandboxMode = spapiUrl.includes('sandbox') || process.env.NODE_ENV === 'development';
          useMockGenerator = process.env.USE_MOCK_DATA_GENERATOR !== 'false';
          
          // Get last sync time
          try {
            const { data: lastSyncData } = await supabase
              .from('sync_progress')
              .select('updated_at')
              .eq('user_id', userId)
              .eq('status', 'completed')
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            
            if (lastSyncData?.updated_at) {
              lastSync = lastSyncData.updated_at;
            }
          } catch (syncError) {
            logger.debug('Failed to get last sync time', { error: syncError });
          }
        } else {
          // Check environment variables (sandbox mode)
          const envRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
          const envClientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
          const envClientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
          
          if (envRefreshToken && envRefreshToken.trim() !== '' && envClientId && envClientSecret) {
            connected = true;
            sandboxMode = true;
            useMockGenerator = true;
            
            // Try to get last sync
            try {
              const { data: lastSyncData } = await supabase
                .from('sync_progress')
                .select('updated_at')
                .eq('user_id', userId)
                .eq('status', 'completed')
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              
              if (lastSyncData?.updated_at) {
                lastSync = lastSyncData.updated_at;
              }
            } catch (syncError) {
              logger.debug('Failed to get last sync time', { error: syncError });
            }
          }
        }
      } catch (error) {
        logger.warn('Error checking Amazon connection', { error, userId });
      }

      return res.json({
        connected,
        sandboxMode,
        useMockGenerator,
        useMockData: useMockGenerator,
        lastSync,
        connectionVerified
      });
    }

    // Handle other providers (Gmail, etc.)
    if (provider === 'gmail') {
      try {
        const token = await tokenManager.getToken(userId, 'gmail');
        const connected = !!(token && token.accessToken);
        
        return res.json({
          connected,
          status: connected ? 'active' : 'disconnected'
        });
      } catch (error) {
        logger.warn('Error checking Gmail connection', { error, userId });
        return res.json({
          connected: false,
          status: 'disconnected'
        });
      }
    }

    // Generic response for other providers
    res.json({
      success: true,
      provider: provider,
      connected: false,
      status: 'unknown'
    });
  } catch (error: any) {
    logger.error('Integration status error', { error, provider: req.params.provider });
    res.status(500).json({
      success: false,
      error: 'Failed to get integration status'
    });
  }
};

export const reconnectIntegration = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    
    // Mock reconnect URL - using template literal with backticks
    res.json({
      success: true,
      provider: provider,
      reconnectUrl: 'http://localhost:3001/api/v1/integrations/' + provider + '/auth/start',
      message: 'Reconnect initiated'
    });
  } catch (error) {
    console.error('Reconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reconnect integration'
    });
  }
};

export const disconnectIntegration = async (req: Request, res: Response) => {
  try {
    // Support both path params and query params (for frontend compatibility)
    const provider = req.params.provider || req.query.provider as string;
    const purge = req.query.purge === '1' || req.query.purge === 'true';
    
    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'Provider is required'
      });
    }

    // Handle provider-specific disconnect logic
    if (provider === 'gmail') {
      // Import and call Gmail disconnect
      const { disconnectGmail } = require('./gmailController');
      return disconnectGmail(req, res);
    } else if (provider === 'amazon') {
      // Import and call Amazon disconnect
      const { disconnectAmazon } = require('./amazonController');
      return disconnectAmazon(req, res);
    } else if (['outlook', 'gdrive', 'dropbox'].includes(provider)) {
      // Handle evidence source providers (outlook, gdrive, dropbox)
      return disconnectEvidenceSource(req, res, provider);
    }

    // Generic disconnect
    res.json({
      success: true,
      provider: provider,
      purged: purge,
      message: 'Integration disconnected successfully'
    });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect integration'
    });
  }
};

export const getAllIntegrations = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // THE PRODUCTION FIX: Query live evidence_sources with identity isolation
    const { data: sources, error } = await supabase
      .from('evidence_sources')
      .select('provider, status, last_sync_at, account_email')
      .or(`user_id.eq.${userId},seller_id.eq.${userId}`)
      // DEFENSE-IN-DEPTH: SQL-level guard against Null UUID legacy data
      .neq('user_id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      logger.error('Failed to fetch integrations from database', { error, userId });
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve integration data'
      });
    }

    // THE HYDRATION BRIDGE: Map DB rows to the expected frontend schema
    // This bridges the 'account_email' (DB) -> 'email' (Frontend) gap
    const integrations = (sources || []).map(source => ({
      provider: source.provider,
      connected: source.status === 'connected',
      status: source.status === 'connected' ? 'active' : 'disconnected',
      lastSync: source.last_sync_at,
      email: source.account_email !== 'unknown' ? source.account_email : undefined
    }));

    // Handle Amazon (Legacy Agent 1 flow)
    // Check if amazon is already in the list; if not, check environment for sandbox
    const hasAmazon = integrations.some(i => i.provider === 'amazon');
    if (!hasAmazon) {
      const envRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
      if (envRefreshToken && envRefreshToken.trim() !== '') {
        integrations.push({
          provider: 'amazon',
          connected: true,
          status: 'active',
          lastSync: new Date().toISOString(),
          email: undefined
        });
      }
    }

    res.json({
      success: true,
      integrations: integrations
    });
  } catch (error) {
    logger.error('All integrations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get integrations'
    });
  }
};
