import { Request, Response } from 'express';
import { getLogger } from '../../../shared/utils/logger';
import { ApiResponse, OAuthResponse } from '../../../shared/types/api';
import { gmailService } from '../services/gmailService';

const logger = getLogger('GmailController');

export const initiateOAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('Initiating Gmail OAuth flow');

    const authUrl = await gmailService.getAuthUrl();

    const response: OAuthResponse = {
      success: true,
      authUrl,
      message: 'OAuth URL generated successfully',
    };

    res.status(200).json({
      success: true,
      message: 'Gmail OAuth initiated',
      data: response,
      timestamp: new Date().toISOString(),
    } as ApiResponse<OAuthResponse>);

  } catch (error) {
    logger.error('Gmail OAuth initiation error:', error);
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

    logger.info('Handling Gmail OAuth callback');

    const tokenData = await gmailService.exchangeCodeForToken(code as string, state as string);

    res.status(200).json({
      success: true,
      message: 'Gmail OAuth completed successfully',
      data: tokenData,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Gmail OAuth callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'OAuth callback failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getEmails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { query, maxResults, labelIds } = req.query;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'User ID is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Fetching Gmail emails for user ${userId}`);

    const emails = await gmailService.fetchEmails(
      userId,
      query as string,
      maxResults ? parseInt(maxResults as string) : 10,
      labelIds as string
    );

    res.status(200).json({
      success: true,
      message: 'Emails retrieved successfully',
      data: emails,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get emails error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to fetch emails',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const getEmailById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, emailId } = req.params;

    if (!userId || !emailId) {
      res.status(400).json({
        success: false,
        message: 'User ID and Email ID are required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Fetching Gmail email ${emailId} for user ${userId}`);

    const email = await gmailService.getEmailById(userId, emailId);

    res.status(200).json({
      success: true,
      message: 'Email retrieved successfully',
      data: email,
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Get email by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to fetch email',
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

    logger.info(`Refreshing Gmail token for user ${userId}`);

    const newTokenData = await gmailService.refreshToken(userId);

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

    logger.info(`Disconnecting Gmail account for user ${userId}`);

    await gmailService.disconnectAccount(userId);

    res.status(200).json({
      success: true,
      message: 'Gmail account disconnected successfully',
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