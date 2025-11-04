import { Request, Response } from 'express';

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
