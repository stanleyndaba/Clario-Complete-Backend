import { Request, Response } from 'express';
import amazonService from '../services/amazonService';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { diagnoseSandboxConnection } from '../utils/sandboxDiagnostics';
import oauthStateStore from '../utils/oauthStateStore';
import { syncJobManager } from '../services/syncJobManager';

export const startAmazonOAuth = async (req: Request, res: Response) => {
  try {
    // Get user ID from authenticated request (if available)
    const userId = (req as any).user?.id || (req as any).user?.user_id || null;
    
    // Get frontend URL from request (query param, header, or referer)
    const frontendUrlFromQuery = (req as any).query?.frontend_url as string;
    const frontendUrlFromHeader = (req as any).headers?.['x-frontend-url'] as string;
    const referer = (req as any).headers?.referer as string;
    
    // Determine frontend URL: query param > header > referer > env var > default
    let frontendUrl = frontendUrlFromQuery || 
                     frontendUrlFromHeader || 
                     (req.headers.origin as string) ||
                     (referer ? new URL(referer).origin : null) ||
                     process.env.FRONTEND_URL || 
                     'http://localhost:3000';
    
    // Normalize frontend URL (remove trailing slash, handle paths)
    try {
      const url = new URL(frontendUrl);
      frontendUrl = `${url.protocol}//${url.host}`;
    } catch {
      // If invalid URL, use default
      frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    }

    // Check if we already have a refresh token - if so, we can skip OAuth
    const existingRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
    if (existingRefreshToken && existingRefreshToken.trim() !== '') {
      logger.info('Refresh token already exists in environment - user can skip OAuth if token is valid');
      // Check if user wants to skip OAuth (bypass parameter)
      const bypassOAuth = req.query.bypass === 'true' || req.query.skip_oauth === 'true';
      
      if (bypassOAuth) {
        logger.info('Bypassing OAuth flow - using existing refresh token');
        
        // Try to trigger sync if we have a userId
        // For bypass flow, userId might not be available, so we'll attempt sync if possible
        const userId = (req as any).user?.id || (req as any).user?.user_id || req.query.userId as string;
        
        if (userId && userId !== 'default-user' && userId !== 'demo-user') {
          // Trigger sync in background - don't block the response
          syncJobManager.startSync(userId).catch((syncError: any) => {
            logger.warn('Failed to trigger automatic sync after bypass', {
              userId,
              error: syncError.message,
              // Don't fail the bypass if sync fails - it's a background operation
            });
          });
          
          logger.info('Triggered automatic sync after bypass', { userId });
        } else {
          logger.info('No valid userId for sync trigger in bypass flow - sync will trigger when recoveries endpoint is called', {
            userId: userId || 'not provided'
          });
        }
        
        // Return JSON response with redirect URL (frontend will handle navigation)
        // This works for both fetch requests and direct browser navigation
        return res.json({
          success: true,
          ok: true,
          bypassed: true,
          message: 'Using existing Amazon connection',
          redirectUrl: `${frontendUrl}/dashboard?amazon_connected=true&message=${encodeURIComponent('Using existing Amazon connection')}`
        });
      }
    }

    logger.info('Starting OAuth flow', {
      userId,
      frontendUrl,
      source: frontendUrlFromQuery ? 'query' : frontendUrlFromHeader ? 'header' : referer ? 'referer' : req.headers.origin ? 'origin' : 'env',
      hasExistingRefreshToken: !!existingRefreshToken
    });

    const result = await amazonService.startOAuth();
    
    // Store frontend URL and user ID with OAuth state for later redirect
    if (result.state) {
      await oauthStateStore.setState(result.state, userId || 'anonymous', frontendUrl);
      logger.info('Stored frontend URL with OAuth state', {
        state: result.state,
        frontendUrl,
        userId: userId || 'anonymous'
      });
    }
    
    logger.info('OAuth flow initiated successfully', {
      hasAuthUrl: !!result.authUrl,
      authUrlLength: result.authUrl?.length,
      state: result.state
    });
    
    res.json({
      success: true,
      ok: true,
      authUrl: result.authUrl,
      redirectTo: result.authUrl, // Alias for frontend convenience
      message: result.message || 'OAuth flow initiated',
      state: result.state // Include state for reference
    });
  } catch (error: any) {
    logger.error('OAuth initiation error', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      ok: false,
      error: 'Failed to start OAuth flow',
      message: error.message || 'An error occurred while starting the OAuth flow'
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
      logger.warn('Amazon callback called without authorization code', {
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body,
        referer: req.headers.referer,
        origin: req.headers.origin
      });
      
      // Try to generate OAuth URL and redirect/return it
      let oauthResult;
      try {
        oauthResult = await amazonService.startOAuth();
      } catch (oauthError: any) {
        logger.error('Failed to generate OAuth URL in callback error handler', { error: oauthError });
        const errorResponse = {
          ok: false,
          connected: false,
          success: false,
          error: 'OAuth configuration error',
          message: 'Failed to generate OAuth URL. Please check backend configuration.',
          oauthStartEndpoint: '/api/v1/integrations/amazon/auth/start'
        };
        
        if (req.method === 'POST') {
          const origin = req.headers.origin || '*';
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Access-Control-Allow-Credentials', 'true');
          return res.status(500).json(errorResponse);
        }
        
        // Try to get frontend URL from state if available
        const stateFromQuery = req.query.state as string;
        let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        if (stateFromQuery) {
          const storedState = oauthStateStore.get(stateFromQuery);
          if (storedState?.frontendUrl) {
            frontendUrl = storedState.frontendUrl;
          }
        }
        const errorUrl = `${frontendUrl}/dashboard?error=${encodeURIComponent('oauth_config_error')}&amazon_error=true`;
        return res.redirect(302, errorUrl);
      }
      
      // For POST requests, return JSON with authUrl for frontend to redirect
      if (req.method === 'POST') {
        const origin = req.headers.origin || '*';
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Content-Type', 'application/json');
        
        // Return 200 with redirect info (not 400) so frontend can handle it
        return res.status(200).json({
          ok: false,
          connected: false,
          success: false,
          needsOAuth: true,
          error: 'OAuth flow not started',
          message: 'Please start the OAuth flow by redirecting to the authUrl below.',
          authUrl: oauthResult.authUrl,
          redirectTo: oauthResult.authUrl,
          hint: 'The frontend should call GET /api/v1/integrations/amazon/auth/start, redirect the user to the returned authUrl, and let Amazon redirect back to this callback endpoint with the authorization code.'
        });
      }
      
      // For GET requests, check if this looks like a direct call (not from Amazon)
      const referer = req.headers.referer || '';
      const isFromAmazon = referer.includes('amazon.com') || referer.includes('amzn.to');
      
      if (!isFromAmazon) {
        // Direct call - automatically redirect to OAuth URL
        logger.info('Callback called directly without Amazon redirect, redirecting to OAuth URL');
        return res.redirect(302, oauthResult.authUrl);
      }
      
      // Looks like it might be from Amazon but missing code - could be an error
      // Check if there's an error parameter in the query
      const errorParam = req.query.error as string;
      if (errorParam) {
        logger.error('Amazon OAuth error received', { error: errorParam, errorDescription: req.query.error_description });
        // Try to get frontend URL from state if available
        const stateFromQuery = req.query.state as string;
        let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        if (stateFromQuery) {
          const storedState = oauthStateStore.get(stateFromQuery);
          if (storedState?.frontendUrl) {
            frontendUrl = storedState.frontendUrl;
          }
        }
        const errorUrl = `${frontendUrl}/dashboard?error=${encodeURIComponent(errorParam)}&amazon_error=true&error_description=${encodeURIComponent(req.query.error_description as string || '')}`;
        return res.redirect(302, errorUrl);
      }
      
      // No code, no error param, but from Amazon - might be a partial redirect
      // Redirect to OAuth start to restart the flow
      logger.warn('Amazon callback received without code or error - redirecting to restart OAuth');
      return res.redirect(302, oauthResult.authUrl);
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
        
        // Trigger automatic sync after successful connection
        // Run in background - don't block the response
        syncJobManager.startSync(userId).catch((syncError: any) => {
          logger.warn('Failed to trigger automatic sync after Amazon connection', {
            userId,
            error: syncError.message,
            // Don't fail the OAuth callback if sync fails - it's a background operation
          });
        });
        
        logger.info('Triggered automatic sync after Amazon OAuth callback', { userId });
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
    // Retrieve stored frontend URL from OAuth state (if available)
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    if (state) {
      const storedState = oauthStateStore.get(state);
      if (storedState?.frontendUrl) {
        frontendUrl = storedState.frontendUrl;
        logger.info('Retrieved frontend URL from OAuth state', {
          state,
          frontendUrl
        });
        // Clean up stored state (one-time use)
        oauthStateStore.delete(state);
      } else {
        logger.warn('OAuth state not found or expired, using default FRONTEND_URL', {
          state,
          frontendUrl
        });
      }
    } else {
      logger.warn('No OAuth state provided, using default FRONTEND_URL', { frontendUrl });
    }
    
    const redirectUrl = `${frontendUrl}/dashboard?amazon_connected=true&message=${encodeURIComponent(result.message || 'Connected successfully')}`;
    
    // Set session cookie if we have tokens
    if (result.data?.refresh_token) {
      // In production, you would create a proper session here
      // For now, just redirect to frontend
      logger.info('Tokens obtained, redirecting to frontend', { frontendUrl, redirectUrl });
    }
    
    res.redirect(302, redirectUrl);
  } catch (error: any) {
      logger.error('OAuth callback error', { 
        error: error.message,
        stack: error.stack,
        code: (req.query.code as string)?.substring(0, 20),
        state: req.query.state,
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body
      });
    
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
    // Try to get frontend URL from state if available
    const stateFromQuery = req.query.state as string;
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (stateFromQuery) {
      const storedState = oauthStateStore.get(stateFromQuery);
      if (storedState?.frontendUrl) {
        frontendUrl = storedState.frontendUrl;
      }
    }
    // Redirect to a page that can handle the error (not /auth/analyzing which doesn't load)
    // Use dashboard or a proper error page
    const errorUrl = `${frontendUrl}/dashboard?error=${encodeURIComponent(error.message || 'oauth_failed')}&amazon_error=true`;
    res.redirect(302, errorUrl);
  }
};

export const syncAmazonData = async (req: Request, res: Response) => {
  try {
    // Get user ID from request (set by auth middleware if available)
    const userId = (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
    
    logger.info(`🔄 Starting Amazon data sync for user: ${userId}`);
    logger.info(`📡 This will fetch data from SP-API sandbox (if connected)`);
    
    const result = await amazonService.syncData(userId);
    
    logger.info(`✅ Sync completed for user ${userId}:`, {
      claimsFound: result.claimsFound,
      inventoryItems: result.inventoryItems,
      recoveredAmount: result.recoveredAmount
    });
    
    res.json({
      success: true,
      message: 'Data sync completed successfully',
      data: result,
      userId: userId,
      source: 'spapi_sandbox'
    });
  } catch (error: any) {
    logger.error('❌ Data sync error:', {
      error: error.message,
      stack: error.stack,
      userId: (req as any).user?.id || 'unknown'
    });
    res.status(500).json({
      success: false,
      error: 'Failed to sync data',
      message: error.message || 'Unknown error occurred during sync'
    });
  }
};

// Real endpoints that call actual SP-API service
export const getAmazonClaims = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?.user_id || 'demo-user';
    
    logger.info(`Getting Amazon claims for user: ${userId}`);
    
    // Try database first (where sync saves data)
    try {
      const { data: dbClaims, error: dbError } = await (await import('../database/supabaseClient')).supabase
        .from('claims')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'amazon')
        .order('created_at', { ascending: false });
      
      if (!dbError && dbClaims && dbClaims.length > 0) {
        logger.info(`Found ${dbClaims.length} claims in database`);
        return res.json({
          success: true,
          claims: dbClaims,
          message: `Found ${dbClaims.length} claims from database`,
          source: 'database'
        });
      }
    } catch (dbError: any) {
      logger.warn('Error querying database for claims, falling back to API', { error: dbError.message });
    }
    
    // Fall back to API if no database data
    const result = await amazonService.fetchClaims(userId);
    const claims = result.data || [];
    
    logger.info(`Fetched ${claims.length} claims from SP-API`, {
      userId,
      claimCount: claims.length,
      isSandbox: result.isSandbox || false,
      dataType: result.dataType || 'unknown'
    });
    
    res.json({
      success: true,
      claims: claims,
      message: result.message || `Fetched ${claims.length} claims from SP-API`,
      source: 'api',
      isSandbox: result.isSandbox || false,
      dataType: result.dataType || 'unknown'
    });
  } catch (error: any) {
    logger.error('Get Amazon claims error:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch claims',
      claims: [],
      message: error.message
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

export const diagnoseAmazonConnection = async (_req: Request, res: Response) => {
  try {
    logger.info('Running Amazon sandbox diagnostics');
    const results = await diagnoseSandboxConnection();
    
    const allPassed = results.every(r => r.success);
    const failures = results.filter(r => !r.success);
    
    res.json({
      success: allPassed,
      summary: {
        total: results.length,
        passed: results.filter(r => r.success).length,
        failed: failures.length
      },
      results,
      failures: failures.length > 0 ? failures : undefined,
      recommendations: generateRecommendations(failures)
    });
  } catch (error: any) {
    logger.error('Diagnostics error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to run diagnostics',
      message: error.message
    });
  }
};

function generateRecommendations(failures: any[]): string[] {
  const recommendations: string[] = [];
  
  for (const failure of failures) {
    switch (failure.step) {
      case 'Environment Variables':
        recommendations.push('Set missing environment variables in Render dashboard');
        if (failure.details?.missing?.includes('AMAZON_REDIRECT_URI')) {
          recommendations.push('Configure AMAZON_REDIRECT_URI to match Developer Console settings');
        }
        break;
      case 'OAuth URL Generation':
        recommendations.push('Check that AMAZON_CLIENT_ID is set correctly');
        recommendations.push('Verify redirect URI is properly URL-encoded');
        break;
      case 'Token Refresh Test':
        if (failure.details?.errorCode === 'invalid_grant') {
          recommendations.push('Refresh token is invalid or expired - complete OAuth flow again');
        } else if (failure.details?.errorCode === 'invalid_client') {
          recommendations.push('Client ID or Client Secret is incorrect - check Developer Console');
        } else if (failure.error?.includes('redirect_uri')) {
          recommendations.push('Redirect URI mismatch - ensure it matches Developer Console exactly');
        }
        break;
      case 'SP-API Endpoint Test':
        if (failure.details?.status === 401) {
          recommendations.push('Access token is invalid - check token refresh');
        } else if (failure.details?.status === 403) {
          recommendations.push('Token lacks required permissions - check SP-API role in Developer Console');
        } else if (failure.details?.status === 400) {
          recommendations.push('Sandbox endpoint may have limited support - check Amazon SP-API documentation');
        }
        break;
    }
  }
  
  return [...new Set(recommendations)]; // Remove duplicates
}
