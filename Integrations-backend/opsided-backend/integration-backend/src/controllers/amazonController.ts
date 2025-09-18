import { Request, Response } from 'express';
import { getLogger } from '../../../shared/utils/logger';
import { ApiResponse, OAuthResponse } from '../../../shared/types/api';
import { amazonService } from '../services/amazonService';

const logger = getLogger('AmazonController');

export const initiateOAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('Initiating Amazon OAuth flow');

    const authUrl = await amazonService.getAuthUrl();

    const response: OAuthResponse = {
      success: true,
      authUrl,
      message: 'OAuth URL generated successfully',
    };

    res.status(200).json({
      success: true,
      message: 'Amazon OAuth initiated',
      data: response,
      timestamp: new Date().toISOString(),
    } as ApiResponse<OAuthResponse>);

  } catch (error) {
    logger.error('Amazon OAuth initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to initiate OAuth',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const handleOAuthCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state } = req.query;

    if (!code) {
      res.status(400).json({
        success: false,
        message: 'Authorization code is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info('Handling Amazon OAuth callback');

    const tokenData = await amazonService.exchangeCodeForToken(code as string, state as string);

    res.status(200).json({
      success: true,
      message: 'Amazon OAuth completed successfully',
      data: tokenData,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Amazon OAuth callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'OAuth callback failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getClaims = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, status } = req.query;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Fetching Amazon claims for user ${userId}`);

    const claims = await amazonService.fetchClaims(
      userId,
      startDate as string,
      endDate as string,
      status as string
    );

    res.status(200).json({
      success: true,
      message: 'Claims retrieved successfully',
      data: claims,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get claims error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to fetch claims',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getInventory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { location, sku } = req.query;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Fetching Amazon inventory for user ${userId}`);

    const inventory = await amazonService.fetchInventory(
      userId,
      location as string,
      sku as string
    );

    res.status(200).json({
      success: true,
      message: 'Inventory retrieved successfully',
      data: inventory,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get inventory error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to fetch inventory',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getFees = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, feeType } = req.query;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Fetching Amazon fees for user ${userId}`);

    const fees = await amazonService.fetchFees(
      userId,
      startDate as string,
      endDate as string,
      feeType as string
    );

    res.status(200).json({
      success: true,
      message: 'Fees retrieved successfully',
      data: fees,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get fees error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to fetch fees',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Refreshing Amazon token for user ${userId}`);

    const newTokenData = await amazonService.refreshToken(userId);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: newTokenData,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to refresh token',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const disconnectAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Disconnecting Amazon account for user ${userId}`);

    await amazonService.disconnectAccount(userId);

    res.status(200).json({
      success: true,
      message: 'Amazon account disconnected successfully',
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Disconnect account error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to disconnect account',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
}; 