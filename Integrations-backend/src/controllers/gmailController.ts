import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import gmailService from '../services/gmailService';
import logger from '../utils/logger';

export const initiateGmailOAuth = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    const authUrl = await gmailService.initiateOAuth(userId);
    
    res.json({
      success: true,
      message: 'Gmail OAuth initiated',
      authUrl
    });
  } catch (error) {
    logger.error('Error initiating Gmail OAuth', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Gmail OAuth'
    });
  }
});

export const handleGmailCallback = asyncHandler(async (req: Request, res: Response) => {
  const { code, state } = req.query;
  
  if (!code || !state) {
    return res.status(400).json({
      success: false,
      message: 'Missing required parameters'
    });
  }

  const userId = state as string;
  
  try {
    await gmailService.handleOAuthCallback(code as string, userId);
    
    // Redirect to frontend with success
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations/gmail?status=success`);
  } catch (error) {
    logger.error('Error handling Gmail OAuth callback', { error, userId });
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations/gmail?status=error`);
  }
});

export const connectGmail = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    const result = await gmailService.connectGmail(userId);
    
    res.json({
      success: true,
      message: result.message,
      authUrl: result.authUrl
    });
  } catch (error) {
    logger.error('Error connecting Gmail', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to connect Gmail'
    });
  }
});

export const getGmailEmails = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const { query, maxResults } = req.query;

  try {
    const emails = await gmailService.fetchEmails(
      userId,
      query as string,
      parseInt(maxResults as string) || 10
    );

    res.json({
      success: true,
      data: emails
    });
  } catch (error) {
    logger.error('Error fetching Gmail emails', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Gmail emails'
    });
  }
});

export const searchGmailEmails = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const { searchQuery, maxResults } = req.query;

  if (!searchQuery) {
    return res.status(400).json({
      success: false,
      message: 'Search query is required'
    });
  }

  try {
    const emails = await gmailService.searchEmails(
      userId,
      searchQuery as string,
      parseInt(maxResults as string) || 10
    );

    res.json({
      success: true,
      data: emails
    });
  } catch (error) {
    logger.error('Error searching Gmail emails', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to search Gmail emails'
    });
  }
});

export const disconnectGmail = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  try {
    await gmailService.disconnect(userId);
    
    res.json({
      success: true,
      message: 'Gmail integration disconnected successfully'
    });
  } catch (error) {
    logger.error('Error disconnecting Gmail integration', { error, userId });
    res.status(500).json({
      success: false,
      message: 'Failed to disconnect Gmail integration'
    });
  }
}); 