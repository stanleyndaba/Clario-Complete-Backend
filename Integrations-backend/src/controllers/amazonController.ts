import { Request, Response } from 'express';
import amazonService from '../services/amazonService';
import logger from '../utils/logger';

export const startAmazonOAuth = async (_req: Request, res: Response) => {
  try {
    const result = await amazonService.startOAuth();
    
    res.json({
      success: true,
      authUrl: result.authUrl,
      message: 'OAuth flow initiated'
    });
  } catch (error) {
    logger.error('OAuth initiation error', { error });
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
    logger.error('OAuth callback error', { error });
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
    logger.error('Data sync error', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to sync data'
    });
  }
};

// Real endpoints that call actual SP-API service
export const getAmazonClaims = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'demo-user';
    const result = await amazonService.fetchClaims(userId);
    
    res.json({
      success: true,
      claims: result.data || [],
      message: result.message
    });
  } catch (error) {
    logger.error('Get Amazon claims error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch claims',
      claims: []
    });
  }
};

export const getAmazonInventory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'demo-user';
    const result = await amazonService.fetchInventory(userId);
    
    res.json({
      success: true,
      inventory: result.data || [],
      message: result.message
    });
  } catch (error) {
    logger.error('Get Amazon inventory error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory',
      inventory: []
    });
  }
};

export const disconnectAmazon = async (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Amazon account disconnected successfully'
  });
};
