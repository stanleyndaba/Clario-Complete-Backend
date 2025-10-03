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
    const { provider } = req.params;
    
    // Mock disconnect
    res.json({
      success: true,
      provider: provider,
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
