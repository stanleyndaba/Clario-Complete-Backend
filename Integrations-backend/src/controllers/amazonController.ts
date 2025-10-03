import { Request, Response } from 'express';
import amazonService from '../services/amazonService';

export const startAmazonOAuth = async (_req: Request, res: Response) => {
  try {
    const result = await amazonService.startOAuth();
    
    res.json({
      success: true,
      authUrl: result.authUrl,
      message: 'OAuth flow initiated'
    });
  } catch (error) {
    console.error('OAuth initiation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start OAuth flow'
    });
  }
};

export const handleAmazonCallback = async (req: Request, res: Response) => {
  try {
    const { code } = req.query;

    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
      return;
    }

    const result = await amazonService.handleCallback(code as string);
    
    res.json({
      success: true,
      message: 'Amazon account connected successfully',
      data: result
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete OAuth flow'
    });
  }
};

export const syncAmazonData = async (_req: Request, res: Response) => {
  try {
    const result = await amazonService.syncData('demo-user');
    
    res.json({
      success: true,
      message: 'Data sync completed',
      data: result
    });
  } catch (error) {
    console.error('Data sync error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync data'
    });
  }
};

// Mock endpoints for other routes that the frontend might call
export const getAmazonClaims = async (_req: Request, res: Response) => {
  res.json({
    success: true,
    claims: [
      { id: 1, amount: 45.50, status: 'pending', type: 'lost_inventory' },
      { id: 2, amount: 120.75, status: 'approved', type: 'fee_overcharge' }
    ]
  });
};

export const getAmazonInventory = async (_req: Request, res: Response) => {
  res.json({
    success: true,
    inventory: [
      { sku: 'PROD-001', quantity: 45, status: 'active' },
      { sku: 'PROD-002', quantity: 12, status: 'inactive' }
    ]
  });
};

export const disconnectAmazon = async (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Amazon account disconnected successfully'
  });
};
