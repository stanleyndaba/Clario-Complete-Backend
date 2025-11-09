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
    
    // Mock integration status
    res.json({
      success: true,
      provider: provider,
      connected: true,
      status: 'active',
      lastSync: new Date().toISOString(),
      data: {
        email: provider === 'gmail' ? 'user@example.com' : undefined,
        account: provider === 'amazon' ? 'Seller123' : undefined
      }
    });
  } catch (error) {
    console.error('Integration status error:', error);
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

export const getAllIntegrations = async (_req: Request, res: Response) => {
  try {
    // Mock all integrations status
    res.json({
      success: true,
      integrations: [
        {
          provider: 'amazon',
          connected: true,
          status: 'active',
          lastSync: new Date().toISOString()
        },
        {
          provider: 'gmail', 
          connected: true,
          status: 'active',
          lastSync: new Date().toISOString()
        },
        {
          provider: 'stripe',
          connected: false,
          status: 'disconnected',
          lastSync: null
        }
      ]
    });
  } catch (error) {
    console.error('All integrations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get integrations'
    });
  }
};
