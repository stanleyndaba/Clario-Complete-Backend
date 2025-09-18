import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import stripeService from '../services/stripeService';
import logger from '../utils/logger';

export const initiateStripeOAuth = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    const authUrl = await stripeService.initiateOAuth(userId);
    
    res.json({
      success: true,
      message: 'Stripe OAuth initiated',
      authUrl
    });
  } catch (error) {
    logger.error('Error initiating Stripe OAuth', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Stripe OAuth'
    });
  }
});

export const handleStripeCallback = asyncHandler(async (req: Request, res: Response) => {
  const { code, state } = req.query;
  
  if (!code || !state) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters'
    });
  }

  const userId = state as string;
  
  try {
    await stripeService.handleOAuthCallback(code as string, userId);
    
    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations/stripe?status=success`);
  } catch (error) {
    logger.error('Error handling Stripe OAuth callback', { error, userId });
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations/stripe?status=error`);
  }
});

export const connectStripe = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    const result = await stripeService.connectStripe(userId);
    
    res.json({
      success: true,
      message: result.message,
      authUrl: result.authUrl
    });
  } catch (error) {
    logger.error('Error connecting Stripe', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to connect Stripe'
    });
  }
});

export const getStripeTransactions = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const { startDate, endDate, limit } = req.query;

  try {
    const transactions = await stripeService.fetchTransactions(
      userId,
      startDate as string,
      endDate as string,
      parseInt(limit as string) || 10
    );

    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    logger.error('Error fetching Stripe transactions', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Stripe transactions'
    });
  }
});

export const getStripeAccountInfo = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    const accountInfo = await stripeService.getAccountInfo(userId);

    res.json({
      success: true,
      data: accountInfo
    });
  } catch (error) {
    logger.error('Error fetching Stripe account info', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Stripe account info'
    });
  }
});

export const getStripeTransaction = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const { transactionId } = req.params;

  if (!transactionId) {
    return res.status(400).json({
      success: false,
      message: 'Transaction ID is required'
    });
  }

  try {
    const transaction = await stripeService.getTransaction(userId, transactionId);

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    logger.error('Error fetching Stripe transaction', { error, userId, transactionId });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Stripe transaction'
    });
  }
});

export const disconnectStripe = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    await stripeService.disconnect(userId);
    
    res.json({
      success: true,
      message: 'Stripe integration disconnected successfully'
    });
  } catch (error) {
    logger.error('Error disconnecting Stripe integration', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect Stripe integration'
    });
  }
}); 