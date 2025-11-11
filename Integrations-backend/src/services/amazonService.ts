// Amazon Service with Real SP-API Integration

import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import { callAmazonSpApi } from '../utils/amazonSpApiClient';

export interface AmazonClaim {
  id: string;
  orderId: string;
  amount: number;
  status: string;
}

export interface AmazonInventory {
  sku: string;
  quantity: number;
  status: string;
  asin?: string;
  fnSku?: string;
  condition?: string;
  location?: string;
}

export interface AmazonFee {
  type: string;
  amount: number;
}

interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export class AmazonService {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private baseUrl: string;
  // Simple in-memory cache for Financial Events API responses
  private financialEventsCache: Map<string, { data: any; expiresAt: Date }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Support both sandbox and production modes
    // Sandbox URL: https://sandbox.sellingpartnerapi-na.amazon.com
    // Production URL: https://sellingpartnerapi-na.amazon.com (or region-specific)
    // Default to sandbox if no URL is specified
    const envUrl = process.env.AMAZON_SPAPI_BASE_URL;
    
    if (envUrl) {
      this.baseUrl = envUrl;
    } else {
      // Default to sandbox for safety, but allow production via NODE_ENV
      if (process.env.NODE_ENV === 'production' && !process.env.AMAZON_SPAPI_BASE_URL) {
        // Production mode but no URL specified - use production URL
        this.baseUrl = 'https://sellingpartnerapi-na.amazon.com';
      } else {
        // Default to sandbox for development/testing
        this.baseUrl = 'https://sandbox.sellingpartnerapi-na.amazon.com';
      }
    }
    
    // Log environment mode on initialization
    if (this.isSandbox()) {
      logger.info('Amazon SP-API initialized in SANDBOX mode - using test data only', {
        baseUrl: this.baseUrl,
        environment: 'sandbox',
        note: 'Set AMAZON_SPAPI_BASE_URL to production URL to switch to production mode'
      });
    } else {
      logger.info('Amazon SP-API initialized in PRODUCTION mode - using live data', {
        baseUrl: this.baseUrl,
        environment: 'production',
        warning: 'This will fetch real production data from Amazon SP-API'
      });
    }
  }

  /**
   * Check if we're using sandbox environment
   */
  isSandbox(): boolean {
    // Check if baseUrl contains 'sandbox'
    if (this.baseUrl.includes('sandbox')) {
      return true;
    }
    
    // Check environment variable explicitly
    if (process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox')) {
      return true;
    }
    
    // If NODE_ENV is development and no explicit production URL, assume sandbox
    if (process.env.NODE_ENV === 'development' && !process.env.AMAZON_SPAPI_BASE_URL) {
      return true;
    }
    
    return false;
  }

  /**
   * Get cache key for Financial Events API call
   */
  private getCacheKey(endpoint: string, params: any): string {
    const paramStr = JSON.stringify(params);
    return `${endpoint}:${paramStr}`;
  }

  /**
   * Get cached response if available and not expired
   */
  private getCachedResponse(cacheKey: string): any | null {
    const cached = this.financialEventsCache.get(cacheKey);
    if (cached && cached.expiresAt > new Date()) {
      logger.info('Returning cached Financial Events API response', { cacheKey });
      return cached.data;
    }
    // Remove expired cache entry
    if (cached) {
      this.financialEventsCache.delete(cacheKey);
    }
    return null;
  }

  /**
   * Store response in cache
   */
  private setCachedResponse(cacheKey: string, data: any): void {
    const expiresAt = new Date(Date.now() + this.CACHE_TTL_MS);
    this.financialEventsCache.set(cacheKey, { data, expiresAt });
    logger.info('Cached Financial Events API response', { cacheKey, expiresAt });
  }

  /**
   * Get rate limit delay based on environment (sandbox can be faster)
   */
  private getRateLimitDelay(): number {
    // Sandbox is typically less strict, so we can use 1 second delay
    // Production needs 2 seconds to be safe
    return this.isSandbox() ? 1000 : 2000;
  }

  private async getAccessToken(userId?: string): Promise<string> {
    // Return token if still valid
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.accessToken;
    }

    // Refresh token (will try database first if userId provided)
    await this.refreshAccessToken(userId);
    return this.accessToken!;
  }

  private async refreshAccessToken(userId?: string): Promise<void> {
    try {
      let refreshToken: string | undefined;
      
      // First, try to get token from database if userId is provided
      if (userId) {
        try {
          const tokenManager = (await import('../utils/tokenManager')).default;
          const tokenData = await tokenManager.getToken(userId, 'amazon');
          
          if (tokenData && tokenData.refreshToken) {
            refreshToken = tokenData.refreshToken;
            logger.info('Using refresh token from database for user', { userId });
          }
        } catch (dbError: any) {
          logger.warn('Could not get token from database, falling back to env vars', { 
            error: dbError.message,
            userId 
          });
        }
      }
      
      // Fall back to environment variable if no database token found
      if (!refreshToken) {
        refreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
        if (refreshToken) {
          logger.info('Using refresh token from environment variables');
        }
      }
      
      // Use AMAZON_SPAPI_CLIENT_ID as fallback if AMAZON_CLIENT_ID not set (for consistency)
      const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
      const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;

      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Amazon SP-API credentials not configured. Please connect your Amazon account first.');
      }

      logger.info('Refreshing Amazon SP-API access token', {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasRefreshToken: !!refreshToken,
        usingDatabaseToken: !!userId && refreshToken !== process.env.AMAZON_SPAPI_REFRESH_TOKEN,
        baseUrl: this.baseUrl
      });

      const response = await axios.post<AccessTokenResponse>(
        'https://api.amazon.com/auth/o2/token',
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        },
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in - 300) * 1000); // 5 min buffer

      logger.info('Successfully refreshed Amazon SP-API access token');
    } catch (error: any) {
      const errorMessage = error.response?.data?.error_description || error.response?.data?.error || error.message;
      logger.error('Failed to refresh access token:', {
        error: errorMessage,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // Provide more helpful error message
      if (error.response?.status === 401) {
        throw new Error('Amazon refresh token is invalid or expired. Please reconnect your Amazon account.');
      }
      throw new Error(`Failed to refresh access token: ${errorMessage}`);
    }
  }

  async startOAuth() {
    try {
      // Check if we already have a refresh token - if so, we can skip OAuth
      const existingRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
      if (existingRefreshToken && existingRefreshToken.trim() !== '') {
        logger.info('Refresh token already exists - OAuth may not be needed if token is valid');
        // Continue with OAuth URL generation anyway, but note that token exists
        // The user can still use existing token if they have it
      }
      
      // Get client ID (checks both variable names for consistency)
      const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
      
      if (!clientId || clientId.trim() === '') {
        logger.warn('Amazon client ID not configured, returning mock URL');
        return {
          authUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?code=mock_auth_code&state=mock_state`,
          message: 'Mock OAuth URL (credentials not configured)'
        };
      }

      // Generate state for CSRF protection
      const state = crypto.randomBytes(32).toString('hex');
      
      // Get redirect URI from environment or use default
      const redirectUri = process.env.AMAZON_REDIRECT_URI || 
                         process.env.AMAZON_SPAPI_REDIRECT_URI ||
                         `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/amazon/auth/callback`;
      
      // Amazon OAuth URL (same for sandbox and production)
      const oauthBase = 'https://www.amazon.com/ap/oa';
      
      // For SP-API OAuth, scope should NOT be included
      // Amazon SP-API uses permissions granted in Seller Central, not OAuth scopes
      // Including scope parameter can cause "unknown scope" errors, especially in sandbox
      // The redirect URI MUST match exactly what's configured in Amazon Developer Console
      // Build OAuth URL WITHOUT scope parameter
      const authUrl = `${oauthBase}?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${state}`;
      
      // Note: Do NOT include scope parameter for Amazon SP-API
      // If you get "unknown scope" error, check Amazon Developer Console Security Profile:
      // 1. Go to https://developer.amazon.com/
      // 2. Login with Amazon → Your Security Profile
      // 3. Web Settings → Ensure no scopes are configured/required
      // 4. The Security Profile should be configured for SP-API, not LWA with scopes

      const isSandboxMode = this.isSandbox();
      
      logger.info('Generated Amazon OAuth URL', {
        hasClientId: !!clientId,
        redirectUri,
        stateLength: state.length,
        authUrlLength: authUrl.length,
        isSandboxMode,
        note: isSandboxMode 
          ? 'SANDBOX MODE: If you get "unknown scope" error, this is likely due to Security Profile configuration in Amazon Developer Console. For sandbox testing, use bypass flow (?bypass=true) instead.'
          : 'OAuth URL generated - ensure Security Profile is configured correctly in Amazon Developer Console'
      });

      return {
        authUrl,
        state,
        sandboxMode: isSandboxMode,
        warning: isSandboxMode 
          ? 'For sandbox testing, using bypass flow (?bypass=true) is recommended if refresh token exists. OAuth flow requires proper Security Profile configuration in Amazon Developer Console.'
          : undefined
      };
    } catch (error: any) {
      logger.error('Error generating OAuth URL:', error);
      throw new Error(`Failed to generate OAuth URL: ${error.message}`);
    }
  }

  async handleCallback(code: string, state?: string): Promise<any> {
    // Get client credentials (declare outside try block so available in catch)
    const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
    const redirectUri = process.env.AMAZON_REDIRECT_URI || 
                       process.env.AMAZON_SPAPI_REDIRECT_URI ||
                       `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/amazon/auth/callback`;

    try {
      if (!clientId || !clientSecret) {
        logger.warn('Amazon credentials not configured, returning sandbox mock response');
        return {
          success: true,
          message: "Sandbox authentication successful (mock mode)",
          mockData: true
        };
      }

      logger.info('Exchanging authorization code for tokens', {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        redirectUri
      });

      // Exchange authorization code for access token and refresh token
      const tokenResponse = await axios.post(
        'https://api.amazon.com/auth/o2/token',
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

      const { access_token, refresh_token, token_type, expires_in } = tokenResponse.data;

      logger.info('Successfully exchanged code for tokens', {
        hasAccessToken: !!access_token,
        hasRefreshToken: !!refresh_token,
        expiresIn: expires_in
      });

      // Store refresh token for future use
      // In production, you would store this in a database associated with the user
      // For now, we'll use environment variable (this is for sandbox testing)
      if (refresh_token) {
        logger.info('Refresh token obtained - store this securely for future API calls');
        // TODO: Store refresh_token in database with user_id
      }

      return {
        success: true,
        message: "Amazon SP-API authentication successful",
        data: {
          access_token: access_token,
          refresh_token: refresh_token, // Store this securely!
          token_type: token_type,
          expires_in: expires_in,
          sandbox_mode: this.isSandbox()
        }
      };
    } catch (error: any) {
      const errorData = error.response?.data || {};
      const errorCode = errorData.error;
      const errorDescription = errorData.error_description || error.message;
      const statusCode = error.response?.status;

      logger.error('Error exchanging authorization code:', {
        error: errorDescription,
        errorCode,
        status: statusCode,
        data: errorData,
        redirectUri,
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasCode: !!code
      });

      // Provide specific error messages based on error code
      let userFriendlyError = errorDescription;
      
      if (errorCode === 'invalid_grant') {
        userFriendlyError = 'Authorization code is invalid or has expired. Please try connecting again.';
      } else if (errorCode === 'invalid_client') {
        userFriendlyError = 'Client ID or Client Secret is incorrect. Please check your Amazon Developer Console settings.';
      } else if (errorCode === 'redirect_uri_mismatch') {
        userFriendlyError = `Redirect URI mismatch. Expected: ${redirectUri}. Make sure this matches exactly in Amazon Developer Console.`;
      } else if (errorCode === 'invalid_request') {
        userFriendlyError = 'Invalid request parameters. Please check your OAuth configuration.';
      } else if (statusCode === 400) {
        userFriendlyError = `Bad request: ${errorDescription}. Check your OAuth configuration.`;
      } else if (statusCode === 401) {
        userFriendlyError = 'Authentication failed. Check your Client ID and Client Secret.';
      }

      // Don't return mock response - throw the error so caller knows it failed
      throw new Error(`Token exchange failed: ${userFriendlyError} (${errorCode || 'unknown'})`);
    }
  }

  async syncData(userId: string) {
    try {
      const inventory = await this.fetchInventory(userId);
      const claims = await this.fetchClaims(userId);
      const fees = await this.fetchFees(userId);

      // Calculate totals from actual data
      const totalRecovered = claims.data.reduce((sum: number, claim: any) => 
        claim.status === 'approved' ? sum + claim.amount : sum, 0);
      const totalFees = fees.data.reduce((sum: number, fee: any) => sum + fee.amount, 0);
      const potentialRecovery = claims.data.reduce((sum: number, claim: any) => 
        claim.status === 'pending' || claim.status === 'under_review' ? sum + claim.amount : sum, 0);

      return {
        status: "completed",
        message: "Sandbox data sync successful",
        recoveredAmount: totalRecovered,
        potentialRecovery: potentialRecovery,
        totalFees: totalFees,
        claimsFound: claims.data.length,
        inventoryItems: inventory.data.length,
        summary: {
          approved_claims: claims.data.filter((c: any) => c.status === 'approved').length,
          pending_claims: claims.data.filter((c: any) => c.status === 'pending').length,
          under_review_claims: claims.data.filter((c: any) => c.status === 'under_review').length,
          active_inventory: inventory.data.filter((i: any) => i.status === 'active').length,
          total_inventory_value: inventory.data.reduce((sum: number, item: any) => sum + (item.quantity * 25), 0) // Estimate $25 per unit
        }
      };
    } catch (error: any) {
      logger.error('Error during sync:', error);
      throw error;
    }
  }

  private async getCredentials(_accountId: string): Promise<any> {
    return {};
  }

  async fetchClaims(accountId: string, startDate?: Date, endDate?: Date): Promise<any> {
    // Determine environment and data type once at the start
    const isSandboxMode = this.isSandbox();
    const environment = isSandboxMode ? 'SANDBOX' : 'PRODUCTION';
    const dataType = isSandboxMode ? 'SANDBOX_TEST_DATA' : 'LIVE_PRODUCTION_DATA';
    
    try {
      const accessToken = await this.getAccessToken(accountId);
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
      
      // Default to last 90 days if no dates provided
      const postedAfter = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const postedBefore = endDate || new Date();
      
      logger.info(`Fetching claims/reimbursements for account ${accountId} from SP-API ${environment}`, {
        baseUrl: this.baseUrl,
        marketplaceId,
        postedAfter: postedAfter.toISOString(),
        postedBefore: postedBefore.toISOString(),
        isSandbox: isSandboxMode,
        environment,
        dataType,
        note: isSandboxMode 
          ? 'Using Amazon SP-API sandbox - returns test/fake data only, not real production data'
          : 'Using Amazon SP-API production - fetching real live data from Amazon'
      });

        // Use Financial Events API to get reimbursements (claims)
        // Financial Events includes: Reimbursement events, Adjustments, etc.
        const baseQuery: Record<string, string> = {
          PostedAfter: postedAfter.toISOString(),
          PostedBefore: postedBefore.toISOString(),
          MarketplaceIds: marketplaceId
        };

        if (isSandboxMode) {
          const testCaseId = process.env.AMAZON_SPAPI_TEST_CASE_ID;
          if (testCaseId) {
            baseQuery.TestCaseId = testCaseId;
          }
        }

        // Check cache for first page (subsequent pages are less cacheable)
        const cacheKey = this.getCacheKey('financialEvents', { ...baseQuery, endpoint: 'claims' });
        const cached = this.getCachedResponse(cacheKey);
        if (cached) {
          logger.info('Using cached claims data', { itemCount: cached.length });
          return {
            success: true,
            data: cached,
            message: `Fetched ${cached.length} claims/reimbursements from SP-API (cached)`,
            fromApi: true,
            isSandbox: isSandboxMode,
            environment,
            dataType,
            cached: true
          };
        }

        const allClaims: any[] = [];
        let nextToken: string | undefined;
        const rateLimitDelay = this.getRateLimitDelay();

        // Paginate through all financial events
        do {
          const query = nextToken ? { ...baseQuery, NextToken: nextToken } : baseQuery;

          const response = await callAmazonSpApi({
            method: 'GET',
            path: '/finances/v0/financialEvents',
            query,
            accessToken
          });

          const payload = response.data?.payload || response.data;
          const financialEvents = payload?.FinancialEvents || {};
          
          // Extract reimbursement events (these are the "claims")
          const reimbursements = financialEvents.FBALiquidationEventList || [];
          const adjustments = financialEvents.AdjustmentEventList || [];
          
          // Transform reimbursements into claims format
          for (const reimbursement of reimbursements) {
            allClaims.push({
              id: reimbursement.OriginalRemovalOrderId || `RMB-${Date.now()}`,
              orderId: reimbursement.OriginalRemovalOrderId,
              amount: parseFloat(reimbursement.LiquidationProceedsAmount?.CurrencyAmount || '0'),
              status: 'approved', // Reimbursements from Financial Events are already processed
              type: 'liquidation_reimbursement',
              currency: reimbursement.LiquidationProceedsAmount?.CurrencyCode || 'USD',
              createdAt: reimbursement.PostedDate || new Date().toISOString(),
              description: `FBA Liquidation reimbursement for ${reimbursement.OriginalRemovalOrderId || 'N/A'}`,
              fromApi: true
            });
          }
          
          // Transform adjustment events (some are reimbursements)
          for (const adjustment of adjustments) {
            const adjustmentAmount = adjustment.AdjustmentAmount?.CurrencyAmount || '0';
            const amount = parseFloat(adjustmentAmount);
            
            // Only include positive adjustments (reimbursements), not charges
            if (amount > 0) {
              allClaims.push({
                id: adjustment.AdjustmentEventId || `ADJ-${Date.now()}`,
                orderId: adjustment.AdjustmentEventId,
                amount: amount,
                status: 'approved',
                type: 'adjustment_reimbursement',
                currency: adjustment.AdjustmentAmount?.CurrencyCode || 'USD',
                createdAt: adjustment.PostedDate || new Date().toISOString(),
                description: adjustment.AdjustmentType || 'Amazon adjustment reimbursement',
                fromApi: true
              });
            }
          }
          
          // Check for next token (pagination)
          nextToken = payload?.NextToken;
          
          // Rate limiting: respect SP-API limits (faster for sandbox)
          if (nextToken) {
            await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
          }
        } while (nextToken);

        logger.info(`Successfully fetched ${allClaims.length} claims/reimbursements from SP-API ${environment}`, {
        itemCount: allClaims.length,
        accountId,
        isSandbox: isSandboxMode,
        environment,
        cacheUsed: false,
        dataType,
        note: isSandboxMode
          ? (allClaims.length === 0 
              ? 'Sandbox may return empty data - this is normal for testing' 
              : 'Sandbox test data retrieved successfully')
          : (allClaims.length === 0
              ? 'No claims found in production data for the specified date range'
              : `Successfully retrieved ${allClaims.length} live production claims from Amazon SP-API`)
      });

        // Cache the first page result
        this.setCachedResponse(cacheKey, allClaims);

      // Track payment status changes for Transparency Agent (after fetching all claims)
      await this.trackPaymentStatusChanges(accountId, allClaims);
      
      return { 
        success: true, 
        data: allClaims, 
        message: isSandboxMode
          ? `Fetched ${allClaims.length} claims/reimbursements from SP-API SANDBOX (test data)`
          : `Fetched ${allClaims.length} claims/reimbursements from SP-API PRODUCTION (live data)`,
        fromApi: true,
        isSandbox: isSandboxMode,
        environment,
        dataType,
        note: isSandboxMode
          ? (allClaims.length === 0 
              ? 'Sandbox returned empty data - this is normal for testing' 
              : 'Sandbox test data retrieved successfully')
          : (allClaims.length === 0
              ? 'No claims found in production data for the specified date range'
              : 'Live production claims retrieved successfully from Amazon SP-API')
      };
    } catch (error: any) {
      const errorDetails = error.response?.data?.errors?.[0] || {};
      const errorMessage = errorDetails.message || error.message || 'Unknown error';
      
      logger.error("Error fetching Amazon claims from SP-API:", {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        errorCode: errorDetails.code,
        errorMessage,
        data: error.response?.data,
        accountId,
        isSandbox: isSandboxMode,
        environment
      });
      
      // Handle errors appropriately for sandbox vs production
      if (isSandboxMode) {
        // In sandbox, empty responses or 404s are normal - return empty array instead of error
        if (error.response?.status === 404 || error.response?.status === 400) {
          logger.info('Sandbox returned empty/error response - returning empty claims (this is normal for sandbox)', {
            status: error.response.status,
            errorMessage,
            accountId,
            environment
          });
          return {
            success: true,
            data: [],
            message: 'Sandbox returned no claims data (normal for testing)',
            fromApi: false,
            isSandbox: true,
            environment,
            dataType,
            note: 'Sandbox may have limited or no test data - this is expected'
          };
        }
        throw new Error(`Sandbox API error: ${errorMessage}. Note: Sandbox may have limited endpoint support.`);
      } else {
        // Production mode - log errors but be more strict
        logger.error(`Production SP-API error while fetching claims: ${errorMessage}`, {
          status: error.response?.status,
          accountId,
          environment,
          error: errorMessage
        });
        
        // For production, if it's a 404 or 400, return empty array (no claims found)
        if (error.response?.status === 404 || error.response?.status === 400) {
          logger.warn('Production SP-API returned 404/400 - no claims found for date range', {
            accountId,
            status: error.response.status
          });
          return {
            success: true,
            data: [],
            message: 'No claims found in production data for the specified date range',
            fromApi: false,
            isSandbox: false,
            environment,
            dataType,
            note: 'Production SP-API returned no claims - this may indicate no claims exist for this date range'
          };
        }
        
        // For other errors in production, throw the error
        throw error;
      }
    }
  }

  async fetchInventory(accountId: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken(accountId);
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';

      logger.info(`Fetching inventory for account ${accountId} from SP-API SANDBOX`, {
        baseUrl: this.baseUrl,
        marketplaceId,
        isSandbox: this.isSandbox(),
        dataType: 'SANDBOX_TEST_DATA',
        note: 'Using Amazon SP-API sandbox - returns test/fake data only, not real production data'
      });

        // Build params - sandbox may not support granularityType
        const query: Record<string, string> = {
          marketplaceIds: marketplaceId
        };

        const isSandboxMode = this.isSandbox();

        // Only include granularityType for production (sandbox may not support it)
        if (!isSandboxMode) {
          query.granularityType = 'Marketplace';
          query.granularityId = marketplaceId;
        }

        if (isSandboxMode) {
          const testCaseId = process.env.AMAZON_SPAPI_TEST_CASE_ID;
          if (testCaseId) {
            query.TestCaseId = testCaseId;
          }
        }

        // Make real SP-API call to fetch inventory
        const response = await callAmazonSpApi({
          method: 'GET',
          path: '/fba/inventory/v1/summaries',
          query,
          accessToken
        });

        // Handle both production and sandbox response formats
        const payload = response.data?.payload || response.data;
      const summaries = payload?.inventorySummaries || (Array.isArray(payload) ? payload : []);
      
      logger.info(`Successfully fetched ${summaries.length} inventory items from SP-API SANDBOX`, {
        itemCount: summaries.length,
        accountId,
          isSandbox: isSandboxMode,
        dataType: 'SANDBOX_TEST_DATA',
        note: summaries.length === 0 
          ? 'Sandbox returned empty inventory - this is normal for testing' 
          : 'Sandbox test inventory data retrieved successfully'
      });

      // Transform SP-API response to our format (handle both formats)
      const inventory = summaries.map((item: any) => ({
        sku: item.sellerSku || item.sku,
        asin: item.asin,
        fnSku: item.fnSku,
        quantity: item.inventoryDetails?.availableQuantity || item.quantity || 0,
        condition: item.condition || 'New',
        location: 'FBA',
        status: (item.inventoryDetails?.availableQuantity || item.quantity || 0) > 0 ? 'active' : 'inactive',
        reserved: item.inventoryDetails?.reservedQuantity || item.reserved || 0,
        damaged: item.inventoryDetails?.damagedQuantity || item.damaged || 0,
        lastUpdated: item.lastUpdatedTime || item.lastUpdated || new Date().toISOString()
      }));

      return { 
        success: true, 
        data: inventory, 
        message: `Fetched ${inventory.length} inventory items from SP-API SANDBOX (test data)`,
        fromApi: true,  // Flag to indicate this is from SP-API (sandbox test data, not mock)
        isSandbox: this.isSandbox(),
        dataType: 'SANDBOX_TEST_DATA',
        note: inventory.length === 0 
          ? 'Sandbox returned empty inventory - this is normal for testing' 
          : 'Sandbox test inventory data retrieved successfully'
      };
    } catch (error: any) {
      // Enhanced error logging for sandbox vs production
      const errorDetails = error.response?.data?.errors?.[0] || {};
      logger.error("Error fetching Amazon inventory from SP-API:", {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        errorCode: errorDetails.code,
        errorMessage: errorDetails.message,
        data: error.response?.data,
        accountId,
        isSandbox: this.isSandbox()
      });
      
      // For sandbox, empty responses or 404s are normal - return empty array instead of error
      const errorMessage = errorDetails.message || error.message;
      if (this.isSandbox()) {
        if (error.response?.status === 404 || error.response?.status === 400) {
          logger.info('Sandbox returned empty/error response - returning empty inventory (this is normal for sandbox)', {
            status: error.response?.status,
            errorMessage,
            accountId
          });
          return {
            success: true,
            data: [],
            message: 'Sandbox returned no inventory data (normal for testing)',
            fromApi: true,
            isSandbox: true,
            dataType: 'SANDBOX_TEST_DATA',
            note: 'Sandbox may have limited or no test data - this is expected'
          };
        }
        throw new Error(`Sandbox API error: ${errorMessage}. Note: Sandbox may have limited endpoint support.`);
      }
      throw new Error(`Failed to fetch inventory from SP-API: ${errorMessage}`);
    }
  }

  /**
   * Get seller information and marketplace participations from Amazon SP-API
   * Handles both production and sandbox response formats
   */
  async getSellersInfo(userId?: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken(userId);
        logger.info('Fetching seller information from SP-API', {
          baseUrl: this.baseUrl,
          isSandbox: this.isSandbox()
        });

        const response = await callAmazonSpApi({
          method: 'GET',
          path: '/sellers/v1/marketplaceParticipations',
          accessToken
        });

        if (response.status === 200) {
        const data = response.data;
        const payload = data.payload || data;

        // Handle different response formats:
        // Production: {"payload": {"marketplaceParticipations": [...]}}
        // Sandbox: {"payload": [...]} or just [...]
        let participations: any[] = [];
        
        if (Array.isArray(payload)) {
          // Sandbox format: payload is directly an array
          participations = payload;
        } else if (typeof payload === 'object' && payload !== null) {
          // Production format: payload has marketplaceParticipations key
          participations = payload.marketplaceParticipations || [];
          
          // Alternative sandbox format: payload is the participation itself
          if (participations.length === 0 && payload.marketplace) {
            participations = [payload];
          }
        }

        // Extract seller info
        const sellerInfo: any = {};
        const marketplaces: any[] = [];

        if (participations.length > 0) {
          const first = participations[0];

          // Extract seller/store info - handle both formats
          sellerInfo.seller_id = first.participation?.sellerId || first.sellerId;
          sellerInfo.seller_name = 
            first.participation?.sellerName || 
            first.storeName || 
            first.sellerName || 
            'Unknown Seller';
          sellerInfo.store_name = first.storeName;
          sellerInfo.has_suspended_participation = 
            first.participation?.hasSuspendedParticipation || 
            first.participation?.hasSuspendedListings || 
            false;

          // Extract marketplace info
          for (const p of participations) {
            const mpData = p.marketplace || p;
            if (mpData && (mpData.id || mpData.marketplaceId)) {
              marketplaces.push({
                id: mpData.id || mpData.marketplaceId,
                name: mpData.name || 'Unknown Marketplace',
                country_code: mpData.countryCode,
                currency_code: mpData.defaultCurrencyCode || mpData.currencyCode,
                language_code: mpData.defaultLanguageCode || mpData.languageCode,
                domain: mpData.domainName || mpData.domain
              });
            }
          }
        }

        return {
          success: true,
          seller_info: sellerInfo,
          marketplaces: marketplaces,
          total_marketplaces: marketplaces.length,
          raw_response: data, // Include for debugging
          is_sandbox: this.isSandbox()
        };
      } else {
        const errorText = response.data || response.statusText;
        logger.error('Sellers API failed', {
          status: response.status,
          error: errorText
        });
        return {
          success: false,
          error: `Sellers API error: ${response.status}`,
          details: errorText
        };
      }
    } catch (error: any) {
      logger.error('Failed to get sellers info', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      return {
        success: false,
        error: error.response?.data?.errors?.[0]?.message || error.message
      };
    }
  }

  async fetchFees(accountId: string, startDate?: Date, endDate?: Date): Promise<any> {
    try {
      const accessToken = await this.getAccessToken(accountId);
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
      
      // Default to last 90 days if no dates provided
      const postedAfter = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const postedBefore = endDate || new Date();
      
      logger.info(`Fetching fees for account ${accountId} from SP-API`, {
        baseUrl: this.baseUrl,
        marketplaceId,
        postedAfter: postedAfter.toISOString(),
        postedBefore: postedBefore.toISOString(),
        isSandbox: this.isSandbox()
      });

        // Use Financial Events API to get fee events
        const baseQuery: Record<string, string> = {
          PostedAfter: postedAfter.toISOString(),
          PostedBefore: postedBefore.toISOString(),
          MarketplaceIds: marketplaceId
        };

        if (this.isSandbox()) {
          const testCaseId = process.env.AMAZON_SPAPI_TEST_CASE_ID;
          if (testCaseId) {
            baseQuery.TestCaseId = testCaseId;
          }
        }

        // Check cache for first page
        const cacheKey = this.getCacheKey('financialEvents', { ...baseQuery, endpoint: 'fees' });
        const cached = this.getCachedResponse(cacheKey);
        if (cached) {
        logger.info('Using cached fees data', { itemCount: cached.length });
        return {
          success: true,
          data: cached,
          message: `Fetched ${cached.length} fees from SP-API (cached)`,
          fromApi: true,
          isSandbox: this.isSandbox(),
          cached: true
        };
      }

        const allFees: any[] = [];
        let nextToken: string | undefined;
      const rateLimitDelay = this.getRateLimitDelay();

      // Paginate through all financial events
      do {
          const query = nextToken ? { ...baseQuery, NextToken: nextToken } : baseQuery;

          const response = await callAmazonSpApi({
            method: 'GET',
            path: '/finances/v0/financialEvents',
            query,
            accessToken
          });

          const payload = response.data?.payload || response.data;
        const financialEvents = payload?.FinancialEvents || {};
        
        // Extract fee events from Financial Events
        const serviceFeeEvents = financialEvents.ServiceFeeEventList || [];
        const orderEvents = financialEvents.OrderEventList || [];
        const adjustmentEvents = financialEvents.AdjustmentEventList || [];
        
        // Process service fees (FBA fees, referral fees, etc.)
        for (const feeEvent of serviceFeeEvents) {
          for (const fee of feeEvent.FeeList || []) {
            const feeAmount = fee.FeeAmount?.CurrencyAmount || '0';
            const amount = Math.abs(parseFloat(feeAmount)); // Fees are negative, make positive
            
            if (amount > 0) {
              allFees.push({
                type: fee.FeeType || 'SERVICE_FEE',
                amount: amount,
                currency: fee.FeeAmount?.CurrencyCode || 'USD',
                orderId: feeEvent.AmazonOrderId,
                sku: feeEvent.SellerSKU,
                asin: feeEvent.ASIN,
                date: feeEvent.PostedDate || new Date().toISOString(),
                description: `${fee.FeeType || 'Service fee'} for order ${feeEvent.AmazonOrderId || 'N/A'}`,
                fromApi: true
              });
            }
          }
        }
        
        // Process order events (fees associated with orders)
        for (const orderEvent of orderEvents) {
          const order = orderEvent.OrderChargeList || [];
          for (const charge of order) {
            const chargeAmount = charge.ChargeAmount?.CurrencyAmount || '0';
            const amount = Math.abs(parseFloat(chargeAmount));
            
            if (amount > 0 && charge.ChargeType) {
              allFees.push({
                type: charge.ChargeType,
                amount: amount,
                currency: charge.ChargeAmount?.CurrencyCode || 'USD',
                orderId: orderEvent.AmazonOrderId,
                date: orderEvent.PostedDate || new Date().toISOString(),
                description: `${charge.ChargeType} for order ${orderEvent.AmazonOrderId || 'N/A'}`,
                fromApi: true
              });
            }
          }
        }
        
        // Process negative adjustments (these are fees/charges)
        for (const adjustment of adjustmentEvents) {
          const adjustmentAmount = adjustment.AdjustmentAmount?.CurrencyAmount || '0';
          const amount = parseFloat(adjustmentAmount);
          
          // Negative amounts are fees/charges
          if (amount < 0) {
            allFees.push({
              type: adjustment.AdjustmentType || 'ADJUSTMENT',
              amount: Math.abs(amount), // Make positive
              currency: adjustment.AdjustmentAmount?.CurrencyCode || 'USD',
              orderId: adjustment.AdjustmentEventId,
              date: adjustment.PostedDate || new Date().toISOString(),
              description: adjustment.AdjustmentType || 'Amazon adjustment fee',
              fromApi: true
            });
          }
        }
        
        // Check for next token (pagination)
        nextToken = payload?.NextToken;
        
        // Rate limiting: respect SP-API limits (faster for sandbox)
        if (nextToken) {
          await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
        }
      } while (nextToken);

      logger.info(`Successfully fetched ${allFees.length} fees from SP-API`, {
        itemCount: allFees.length,
        accountId,
        isSandbox: this.isSandbox(),
        cacheUsed: false
      });

      // Cache the first page result
        this.setCachedResponse(cacheKey, allFees);

      return { 
        success: true, 
        data: allFees, 
        message: `Fetched ${allFees.length} fees from SP-API`,
        fromApi: true,
        isSandbox: this.isSandbox()
      };
    } catch (error: any) {
      const errorDetails = error.response?.data?.errors?.[0] || {};
      logger.error("Error fetching Amazon fees from SP-API:", {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        errorCode: errorDetails.code,
        errorMessage: errorDetails.message,
        data: error.response?.data,
        accountId,
        isSandbox: this.isSandbox()
      });
      
      // For sandbox, provide more helpful error messages
      const errorMessage = errorDetails.message || error.message;
      if (this.isSandbox() && error.response?.status === 400) {
        throw new Error(`Sandbox API error: ${errorMessage}. Note: Sandbox may have limited endpoint support.`);
      }
      throw new Error(`Failed to fetch fees from SP-API: ${errorMessage}`);
    }
  }

  /**
   * Track payment status changes for Transparency Agent
   * Sends SSE events when claim payment status changes
   */
  private async trackPaymentStatusChanges(accountId: string, claims: any[]): Promise<void> {
    try {
      const { supabase } = await import('../database/supabaseClient');
      const sseHub = (await import('../utils/sseHub')).default;

      // Get previous claim statuses from database
      const { data: previousClaims } = await supabase
        .from('detection_results')
        .select('id, status, estimated_value, currency')
        .eq('seller_id', accountId)
        .in('status', ['pending', 'reviewed', 'disputed']);

      const previousClaimsMap = new Map((previousClaims || []).map((c: any) => [c.id, c]));

      // Track status changes and send SSE events
      for (const claim of claims) {
        const previousClaim = previousClaimsMap.get(claim.id) as { status: string; estimated_value: number; currency?: string } | undefined;
        
        if (previousClaim && claim.status === 'approved' && previousClaim.status !== 'approved') {
          // Payment approved - send transparency event
          sseHub.sendEvent(accountId, 'payment_approved', {
            claim_id: claim.id,
            order_id: claim.orderId,
            amount: claim.amount,
            currency: claim.currency || 'USD',
            previous_status: previousClaim.status,
            new_status: claim.status,
            message: `Claim approved! Payment of ${claim.amount} ${claim.currency || 'USD'} will be processed.`,
            timestamp: new Date().toISOString()
          });

          logger.info('Payment status change detected', {
            account_id: accountId,
            claim_id: claim.id,
            previous_status: previousClaim.status,
            new_status: claim.status,
            amount: claim.amount
          });
        }

        // Reconcile payment amount (Transparency Agent)
        if (claim.status === 'approved' && previousClaim) {
          const expectedAmount = previousClaim.estimated_value;
          const actualAmount = claim.amount;
          const discrepancy = Math.abs(expectedAmount - actualAmount);

          if (discrepancy > 0.01) { // More than 1 cent difference
            sseHub.sendEvent(accountId, 'payment_discrepancy', {
              claim_id: claim.id,
              expected_amount: expectedAmount,
              actual_amount: actualAmount,
              discrepancy: discrepancy,
              currency: claim.currency || previousClaim.currency || 'USD',
              message: `Payment discrepancy detected: Expected $${expectedAmount}, received $${actualAmount}. Difference: $${discrepancy}`,
              timestamp: new Date().toISOString()
            });

            logger.warn('Payment discrepancy detected', {
              account_id: accountId,
              claim_id: claim.id,
              expected: expectedAmount,
              actual: actualAmount,
              discrepancy
            });
          } else {
            // Payment reconciled successfully
            sseHub.sendEvent(accountId, 'payment_reconciled', {
              claim_id: claim.id,
              amount: actualAmount,
              currency: claim.currency || 'USD',
              message: `Payment reconciled successfully: $${actualAmount} matches expected amount.`,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    } catch (error: any) {
      logger.error('Error tracking payment status changes', {
        error: error.message,
        account_id: accountId
      });
      // Don't throw - this is a monitoring function, shouldn't break main flow
    }
  }
}

export default new AmazonService();
