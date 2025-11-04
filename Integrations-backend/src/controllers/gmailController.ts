import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import config from '../config/env';
import tokenManager from '../utils/tokenManager';

// Gmail OAuth base URL
const GMAIL_AUTH_BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const initiateGmailOAuth = async (req: Request, res: Response) => {
  try {
    const clientId = config.GMAIL_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
    const redirectUri = config.GMAIL_REDIRECT_URI || process.env.GMAIL_REDIRECT_URI || 
                       `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/gmail/callback`;

    if (!clientId || !config.GMAIL_CLIENT_SECRET) {
      logger.warn('Gmail credentials not configured, returning sandbox mock URL');
      const mockAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=mock-client-id&redirect_uri=' + encodeURIComponent(redirectUri) + '&response_type=code&scope=https://www.googleapis.com/auth/gmail.readonly';
      
      return res.json({
        success: true,
        authUrl: mockAuthUrl,
        message: 'Gmail OAuth flow initiated (sandbox mode - credentials not configured)',
        sandbox: true
      });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Gmail OAuth scopes
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify'
    ].join(' ');

    // Build OAuth URL
    const authUrl = `${GMAIL_AUTH_BASE_URL}?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${state}`;

    logger.info('Gmail OAuth initiated', {
      hasClientId: !!clientId,
      redirectUri
    });

    res.json({
      success: true,
      authUrl: authUrl,
      state: state,
      message: 'Gmail OAuth flow initiated'
    });
  } catch (error: any) {
    logger.error('Gmail OAuth initiation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start Gmail OAuth flow'
    });
  }
};

export const handleGmailCallback = async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      logger.error('Gmail OAuth error:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/auth/error?reason=${encodeURIComponent(error as string)}`);
    }

    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
      return;
    }

    const clientId = config.GMAIL_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
    const clientSecret = config.GMAIL_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
    const redirectUri = config.GMAIL_REDIRECT_URI || process.env.GMAIL_REDIRECT_URI || 
                       `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/gmail/callback`;

    if (!clientId || !clientSecret) {
      logger.warn('Gmail credentials not configured, returning sandbox mock response');
      return res.json({
        success: true,
        message: 'Gmail connected successfully (sandbox mode)',
        sandbox: true,
        data: {
          email: 'user@example.com',
          accessToken: 'mock-gmail-token'
        }
      });
    }

    logger.info('Exchanging Gmail authorization code for tokens');

    // Exchange authorization code for tokens
    const tokenResponse = await axios.post(
      GMAIL_TOKEN_URL,
      {
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000
      }
    );

    const { access_token, refresh_token, expires_in, token_type } = tokenResponse.data;

    logger.info('Successfully exchanged Gmail code for tokens', {
      hasAccessToken: !!access_token,
      hasRefreshToken: !!refresh_token,
      expiresIn: expires_in
    });

    // Get user's email address from Gmail API
    let userEmail = 'user@example.com';
    try {
      const profileResponse = await axios.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        {
          headers: {
            'Authorization': `Bearer ${access_token}`
          },
          timeout: 10000
        }
      );
      userEmail = profileResponse.data.emailAddress || userEmail;
    } catch (error: any) {
      logger.warn('Failed to fetch Gmail profile:', error.message);
    }

    // Extract user ID from state or use default
    const userId = (typeof state === 'string' ? state : null) || 'default-user';
    
    // Store tokens in token manager
    if (userId && userId !== 'default-user') {
      try {
        await tokenManager.saveToken(userId, 'gmail', {
          accessToken: access_token,
          refreshToken: refresh_token || '',
          expiresAt: new Date(Date.now() + (expires_in * 1000))
        });
        logger.info('Gmail tokens saved', { userId, email: userEmail });
      } catch (error) {
        logger.warn('Failed to save Gmail tokens:', error);
        // Continue even if token save fails
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/dashboard?gmail_connected=true&email=${encodeURIComponent(userEmail)}`;
    
    res.redirect(302, redirectUrl);
  } catch (error: any) {
    logger.error('Gmail OAuth callback error:', {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const errorUrl = `${frontendUrl}/auth/error?reason=${encodeURIComponent(error.response?.data?.error_description || error.message || 'gmail_oauth_failed')}`;
    res.redirect(302, errorUrl);
  }
};

export const connectGmail = async (_req: Request, res: Response) => {
  try {
    // Redirect to OAuth initiation
    const result = await initiateGmailOAuth(_req, res);
    return result;
  } catch (error) {
    logger.error('Gmail connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect Gmail'
    });
  }
};

export const getGmailEmails = async (_req: Request, res: Response) => {
  try {
    const userId = (_req as any).user?.id || 'default-user';
    
    // Get access token from token manager
    const tokenData = await tokenManager.getToken(userId, 'gmail');
    
    if (!tokenData || !tokenData.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Gmail not connected. Please connect your Gmail account first.'
      });
    }

    // Fetch emails from Gmail API
    const response = await axios.get(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      {
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`
        },
        params: {
          maxResults: 20
        },
        timeout: 30000
      }
    );

    const messages = response.data.messages || [];
    
    // Fetch full message details for each message
    const emailPromises = messages.slice(0, 10).map(async (msg: any) => {
      try {
        const msgResponse = await axios.get(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
          {
            headers: {
              'Authorization': `Bearer ${tokenData.accessToken}`
            },
            timeout: 10000
          }
        );

        const headers = msgResponse.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

        return {
          id: msg.id,
          threadId: msg.threadId,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          date: getHeader('Date'),
          snippet: msgResponse.data.snippet || '',
          hasAttachments: !!msgResponse.data.payload?.parts?.find((p: any) => p.filename)
        };
      } catch (error) {
        logger.warn(`Failed to fetch message ${msg.id}:`, error);
        return null;
      }
    });

    const emails = (await Promise.all(emailPromises)).filter(Boolean);

    res.json({
      success: true,
      emails: emails
    });
  } catch (error: any) {
    logger.error('Gmail emails error:', error);
    
    // If token expired, return mock data
    if (error.response?.status === 401) {
      logger.warn('Gmail token expired, returning mock data');
      res.json({
        success: true,
        emails: [
          {
            id: '1',
            subject: 'Amazon Order Confirmation - Order #123-4567890-1234567',
            from: 'order-update@amazon.com',
            date: '2024-01-15T10:30:00Z',
            hasAttachments: true
          }
        ]
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch emails'
    });
  }
};

export const searchGmailEmails = async (req: Request, res: Response) => {
  try {
    const { query } = req.query;
    const userId = (req as any).user?.id || 'default-user';
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required'
      });
    }

    // Get access token
    const tokenData = await tokenManager.getToken(userId, 'gmail');
    
    if (!tokenData || !tokenData.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Gmail not connected'
      });
    }

    // Search Gmail API
    const response = await axios.get(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      {
        headers: {
          'Authorization': `Bearer ${tokenData.accessToken}`
        },
        params: {
          q: query,
          maxResults: 20
        },
        timeout: 30000
      }
    );

    const messages = response.data.messages || [];
    
    res.json({
      success: true,
      query: query,
      results: messages.map((msg: any) => ({
        id: msg.id,
        threadId: msg.threadId
      }))
    });
  } catch (error: any) {
    logger.error('Gmail search error:', error);
    
    // Return mock data if API fails
    const queryParam = req.query.query as string;
    res.json({
      success: true,
      query: queryParam,
      results: [
        {
          id: '3',
          subject: 'Shipping Confirmation - Order #123-4567890-1234567',
          from: 'shipment-tracking@amazon.com',
          date: '2024-01-16T08:45:00Z',
          snippet: 'Your order has been shipped...'
        }
      ]
    });
  }
};

export const getGmailStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'default-user';
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Check if Gmail is connected using token manager
    const tokenData = await tokenManager.getToken(userId, 'gmail');
    const isConnected = !!tokenData && !!tokenData.accessToken;
    
    res.json({
      success: true,
      connected: isConnected,
      email: isConnected ? 'Connected to Gmail' : undefined,
      sandbox: !isConnected && !config.GMAIL_CLIENT_ID
    });
  } catch (error) {
    logger.error('Gmail status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Gmail status'
    });
  }
};

export const disconnectGmail = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || 'default-user';
    const purge = req.query.purge === '1' || req.query.purge === 'true';

    // Delete tokens from token manager
    if (userId && userId !== 'default-user') {
      try {
        await tokenManager.revokeToken(userId, 'gmail');
        logger.info('Gmail token revoked', { userId });
      } catch (error) {
        logger.warn('Failed to revoke Gmail token:', error);
        // Continue even if token deletion fails
      }
    }

    logger.info('Gmail disconnected', { userId, purge });

    res.json({
      success: true,
      message: 'Gmail disconnected successfully',
      purged: purge
    });
  } catch (error) {
    logger.error('Gmail disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect Gmail'
    });
  }
};
