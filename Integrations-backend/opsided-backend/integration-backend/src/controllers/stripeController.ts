import { Request, Response } from 'express';
import { getLogger } from '../../../shared/utils/logger';
import { ApiResponse, OAuthResponse } from '../../../shared/types/api';
import { stripeService } from '../services/stripeService';

const logger = getLogger('StripeController');

export const initiateOAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('Initiating Stripe OAuth flow');

    const authUrl = await stripeService.getAuthUrl();

    const response: OAuthResponse = {
      success: true,
      authUrl,
      message: 'OAuth URL generated successfully',
    };

    res.status(200).json({
      success: true,
      message: 'Stripe OAuth initiated',
      data: response,
      timestamp: new Date().toISOString(),
    } as ApiResponse<OAuthResponse>);

  } catch (error) {
    logger.error('Stripe OAuth initiation error:', error);
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

    logger.info('Handling Stripe OAuth callback');

    const tokenData = await stripeService.exchangeCodeForToken(code as string, state as string);

    res.status(200).json({
      success: true,
      message: 'Stripe OAuth completed successfully',
      data: tokenData,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Stripe OAuth callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'OAuth callback failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, limit, status } = req.query;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Fetching Stripe transactions for user ${userId}`);

    const transactions = await stripeService.fetchTransactions(
      userId,
      startDate as string,
      endDate as string,
      limit ? parseInt(limit as string) : 10,
      status as string
    );

    res.status(200).json({
      success: true,
      message: 'Transactions retrieved successfully',
      data: transactions,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to fetch transactions',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getCharges = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, limit, status } = req.query;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Fetching Stripe charges for user ${userId}`);

    const charges = await stripeService.fetchCharges(
      userId,
      startDate as string,
      endDate as string,
      limit ? parseInt(limit as string) : 10,
      status as string
    );

    res.status(200).json({
      success: true,
      message: 'Charges retrieved successfully',
      data: charges,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get charges error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to fetch charges',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getRefunds = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, limit, status } = req.query;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Fetching Stripe refunds for user ${userId}`);

    const refunds = await stripeService.fetchRefunds(
      userId,
      startDate as string,
      endDate as string,
      limit ? parseInt(limit as string) : 10,
      status as string
    );

    res.status(200).json({
      success: true,
      message: 'Refunds retrieved successfully',
      data: refunds,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get refunds error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to fetch refunds',
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

    logger.info(`Refreshing Stripe token for user ${userId}`);

    const newTokenData = await stripeService.refreshToken(userId);

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

    logger.info(`Disconnecting Stripe account for user ${userId}`);

    await stripeService.disconnectAccount(userId);

    res.status(200).json({
      success: true,
      message: 'Stripe account disconnected successfully',
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