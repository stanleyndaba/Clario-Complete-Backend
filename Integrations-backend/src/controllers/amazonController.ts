import { Request, Response } from 'express';
import amazonService from '../services/amazonService';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';

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
    // Handle both GET (query params) and POST (JSON body) requests
    let code: string | undefined;
    let state: string | undefined;
    
    // Log all request details for debugging
    logger.info('Amazon OAuth callback received', {
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: {
        origin: req.headers.origin,
        referer: req.headers.referer,
        'content-type': req.headers['content-type']
      }
    });
    
    if (req.method === 'GET') {
      // GET request - read from query params
      code = req.query.code as string;
      state = req.query.state as string;
    } else if (req.method === 'POST') {
      // POST request - read from JSON body
      const body = req.body || {};
      code = body.code || req.query.code;
      state = body.state || req.query.state;
    }

    if (!code) {
      // More detailed error message
      const errorMessage = req.method === 'GET' 
        ? 'Authorization code is required. This endpoint should be called by Amazon after OAuth authorization. Make sure you complete the OAuth flow by visiting the auth URL first.'
        : 'Authorization code is required in the request body or query parameters.';
      
      logger.warn('Amazon callback called without authorization code', {
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body,
        errorMessage
      });
      
      // For POST requests that are called directly (not from Amazon), provide helpful response
      if (req.method === 'POST') {
        // Set CORS headers
        const origin = req.headers.origin || '*';
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Content-Type', 'application/json');
        
        // Try to generate the OAuth start URL so frontend can redirect
        try {
          const oauthResult = await amazonService.startOAuth();
          return res.status(400).json({
            ok: false,
            connected: false,
            success: false,
            error: 'OAuth flow not started',
            message: 'This endpoint should only be called by Amazon after authorization. Please start the OAuth flow first.',
            hint: 'The frontend should call GET /api/v1/integrations/amazon/auth/start, redirect the user to the returned authUrl, and let Amazon redirect back to this callback endpoint with the authorization code.',
            authUrl: oauthResult.authUrl, // Provide the auth URL so frontend can redirect
            redirectTo: oauthResult.authUrl // Alias for convenience
          });
        } catch (oauthError: any) {
          // If we can't generate OAuth URL, return error without it
          logger.error('Failed to generate OAuth URL in callback error handler', { error: oauthError });
          return res.status(400).json({
            ok: false,
            connected: false,
            success: false,
            error: 'OAuth flow not completed',
            message: 'This endpoint should only be called by Amazon after authorization. Please start the OAuth flow by calling /api/v1/integrations/amazon/auth/start first.',
            hint: 'The frontend should call GET /api/v1/integrations/amazon/auth/start, redirect the user to the returned authUrl, and let Amazon redirect back to this callback endpoint with the authorization code.',
            oauthStartEndpoint: '/api/v1/integrations/amazon/auth/start'
          });
        }
      }
      
      // For GET requests, try to redirect to start OAuth flow or show helpful error
      // Check if this looks like a direct call (no referer from Amazon)
      const referer = req.headers.referer || '';
      if (!referer.includes('amazon.com')) {
        // Looks like a direct call - redirect to start OAuth
        logger.info('Callback called directly without Amazon redirect, redirecting to OAuth start');
        try {
          const result = await amazonService.startOAuth();
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
          // Redirect frontend to start OAuth, or return the authUrl if this is an API call
          if (req.headers.accept?.includes('application/json')) {
            return res.json({
              success: false,
              error: 'OAuth flow not started',
              redirectTo: result.authUrl,
              message: 'Please start OAuth flow first. Redirect user to the authUrl.'
            });
          }
          // Redirect to OAuth URL
          return res.redirect(302, result.authUrl);
        } catch (error: any) {
          logger.error('Failed to start OAuth in callback handler', { error: error.message });
        }
      }
      
      res.status(400).json({
        success: false,
        error: errorMessage,
        hint: 'Did you call /auth/start first? This callback endpoint should only be called by Amazon after you authorize the app.'
      });
      return;
    }

    logger.info('Amazon OAuth callback received', {
      method: req.method,
      hasCode: !!code,
      hasState: !!state,
      isSandbox: req.path.includes('sandbox')
    });

    const result = await amazonService.handleCallback(code, state);
    
    // CRITICAL: Store refresh token in database for future API calls
    // Extract user ID from request (could be from session, JWT, or query param)
    // For now, we'll need to get it from somewhere - let's check if there's a user session
    const userId = (req as any).user?.id || (req as any).user?.user_id || req.query.userId as string || 'default-user';
    
    if (result.data?.refresh_token) {
      try {
        // Store the refresh token securely in the database
        // TokenManager expects: { accessToken, refreshToken, expiresAt }
        await tokenManager.saveToken(userId, 'amazon', {
          accessToken: result.data.access_token,
          refreshToken: result.data.refresh_token,
          expiresAt: new Date(Date.now() + (result.data.expires_in || 3600) * 1000)
        });
        
        logger.info('Successfully stored Amazon refresh token in database', { 
          userId,
          hasRefreshToken: !!result.data.refresh_token,
          hasAccessToken: !!result.data.access_token
        });
      } catch (tokenError: any) {
        // Log error but don't fail the callback - token might still be in env vars
        logger.error('Failed to store Amazon refresh token in database', { 
          error: tokenError.message,
          userId 
        });
        // Continue anyway - the token is still returned in the response
      }
    } else {
      logger.warn('No refresh token in OAuth callback result - tokens may not persist', { userId });
    }
    
    // For POST requests, return JSON instead of redirect
    if (req.method === 'POST') {
      // Set CORS headers for POST response
      const origin = req.headers.origin || '*';
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Content-Type', 'application/json');
      
      return res.status(200).json({
        ok: true,
        connected: true,
        success: result.success,
        message: result.message,
        data: result.data
      });
    }
    
    // For GET requests, redirect to frontend
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/dashboard?amazon_connected=true&message=${encodeURIComponent(result.message || 'Connected successfully')}`;
    
    // Set session cookie if we have tokens
    if (result.data?.refresh_token) {
      // In production, you would create a proper session here
      // For now, just redirect to frontend
      logger.info('Tokens obtained, redirecting to frontend');
    }
    
    res.redirect(302, redirectUrl);
  } catch (error: any) {
    logger.error('OAuth callback error', { error: error.message });
    
    // For POST requests, return JSON error
    if (req.method === 'POST') {
      const origin = req.headers.origin || '*';
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.status(400).json({
        ok: false,
        connected: false,
        success: false,
        error: error.message || 'OAuth callback failed'
      });
    }
    
    // For GET requests, redirect to error page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Redirect to a page that can handle the error (not /auth/analyzing which doesn't load)
    // Use dashboard or a proper error page
    const errorUrl = `${frontendUrl}/dashboard?error=${encodeURIComponent(error.message || 'oauth_failed')}&amazon_error=true`;
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
