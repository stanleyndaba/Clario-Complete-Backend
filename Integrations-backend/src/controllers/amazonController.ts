import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import amazonService from '../services/amazonService';
import logger from '../utils/logger';
import { silentStripeOnboardingQueue } from '../jobs/silentStripeOnboardingJob';
import { createStateValidator } from '../utils/stateValidator';
import { getRedisClient } from '../utils/redisClient';

export const initiateAmazonOAuth = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    const authUrl = await amazonService.initiateOAuth(userId);
    res.json({
      success: true,
      message: 'Amazon OAuth initiated',
      authUrl
    });
  } catch (error) {
    logger.error('Error initiating Amazon OAuth', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Amazon OAuth'
    });
  }
});

export const handleAmazonCallback = asyncHandler(async (req: Request, res: Response) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).json({ success: false, message: 'Missing OAuth parameters' });
  }

  // Validate OAuth state
  try {
    const redisClient = await getRedisClient();
    const stateValidator = createStateValidator(redisClient);
    const stateValidation = await stateValidator.validateOAuthState(state as string);
    
    if (!stateValidation.valid) {
      logger.warn('Invalid OAuth state received', { state: state as string });
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or expired OAuth state. Please try again.' 
      });
    }

    const userId = stateValidation.userId!;
    logger.info('OAuth state validated successfully', { userId });
    
    await amazonService.handleOAuthCallback(code as string, userId);
    // Enqueue silent Stripe onboarding job (do not await)
    try {
      await silentStripeOnboardingQueue.add('silent-stripe-onboarding', { userId }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false
      });
      logger.info('Silent Stripe onboarding job enqueued', { userId });
    } catch (err) {
      logger.error('Failed to enqueue silent Stripe onboarding job', { userId, error: err.message });
    }
    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations/amazon?status=success`);
  } catch (error) {
    const message = (error as any)?.message || 'OAuth failed';
    logger.error('Amazon OAuth callback failed', { userId, error: message });
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations/amazon?status=error&reason=${encodeURIComponent(message)}`);
  }
});

export const getAmazonClaims = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const { startDate, endDate } = req.query;

  try {
    const claims = await amazonService.fetchClaims(
      userId,
      startDate as string,
      endDate as string
    );

    res.json({
      success: true,
      data: claims
    });
  } catch (error) {
    logger.error('Error fetching Amazon claims', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Amazon claims'
    });
  }
});

export const getAmazonInventory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const { marketplaceId } = req.query;

  try {
    const inventory = await amazonService.fetchInventory(
      userId,
      marketplaceId as string
    );

    res.json({
      success: true,
      data: inventory
    });
  } catch (error) {
    logger.error('Error fetching Amazon inventory', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Amazon inventory'
    });
  }
});

export const getAmazonFees = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const { startDate, endDate } = req.query;

  try {
    const fees = await amazonService.fetchFees(
      userId,
      startDate as string,
      endDate as string
    );

    res.json({
      success: true,
      data: fees
    });
  } catch (error) {
    logger.error('Error fetching Amazon fees', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Amazon fees'
    });
  }
});

export const disconnectAmazon = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    await amazonService.disconnect(userId);
    
    res.json({
      success: true,
      message: 'Amazon integration disconnected successfully'
    });
  } catch (error) {
    logger.error('Error disconnecting Amazon integration', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect Amazon integration'
    });
  }
}); 