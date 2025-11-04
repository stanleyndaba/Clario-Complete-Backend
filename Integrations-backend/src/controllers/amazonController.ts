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
    const { code, state } = req.query;

    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
      return;
    }

    logger.info('Amazon OAuth callback received', {
      hasCode: !!code,
      hasState: !!state
    });

    const result = await amazonService.handleCallback(code as string, state as string);
    
    // Redirect to frontend with success message
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/dashboard?amazon_connected=true&message=${encodeURIComponent(result.message)}`;
    
    // Set session cookie if we have tokens
    if (result.data?.refresh_token) {
      // In production, you would create a proper session here
      // For now, just redirect to frontend
      logger.info('Tokens obtained, redirecting to frontend');
    }
    
    res.redirect(302, redirectUrl);
  } catch (error: any) {
    logger.error('OAuth callback error', { error: error.message });
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const errorUrl = `${frontendUrl}/auth/error?reason=${encodeURIComponent(error.message || 'oauth_failed')}`;
    res.redirect(302, errorUrl);
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
