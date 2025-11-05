// Amazon Service with Real SP-API Integration

import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';

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
    // Use sandbox URL if in development, otherwise production
    this.baseUrl = process.env.AMAZON_SPAPI_BASE_URL || 
                   (process.env.NODE_ENV === 'production' 
                     ? 'https://sellingpartnerapi-na.amazon.com' 
                     : 'https://sandbox.sellingpartnerapi-na.amazon.com');
  }

  /**
   * Check if we're using sandbox environment
   */
  private isSandbox(): boolean {
    return this.baseUrl.includes('sandbox') || 
           process.env.AMAZON_SPAPI_BASE_URL?.includes('sandbox') === true;
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
      
      // For SP-API OAuth, scope is typically not required or should be empty
      // The redirect URI MUST match exactly what's configured in Amazon Seller Central
      // Build OAuth URL without scope parameter (or with empty scope)
      const authUrl = `${oauthBase}?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${state}`;

      logger.info('Generated Amazon OAuth URL', {
        hasClientId: !!clientId,
        redirectUri,
        stateLength: state.length,
        authUrlLength: authUrl.length
      });

      return {
        authUrl,
        state
      };
    } catch (error: any) {
      logger.error('Error generating OAuth URL:', error);
      throw new Error(`Failed to generate OAuth URL: ${error.message}`);
    }
  }

  async handleCallback(code: string, state?: string): Promise<any> {
    try {
      // Get client credentials
      const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
      const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;
      const redirectUri = process.env.AMAZON_REDIRECT_URI || 
                         process.env.AMAZON_SPAPI_REDIRECT_URI ||
                         `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/amazon/auth/callback`;

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
      logger.error('Error exchanging authorization code:', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });

      // If token exchange fails, return sandbox mock response for testing
      logger.warn('Token exchange failed, returning sandbox mock response');
      return {
        success: true,
        message: "Sandbox authentication successful (mock mode due to token exchange failure)",
        mockData: true,
        error: error.response?.data?.error_description || error.message
      };
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
    try {
      const accessToken = await this.getAccessToken(accountId);
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';
      
      // Default to last 90 days if no dates provided
      const postedAfter = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const postedBefore = endDate || new Date();
      
      logger.info(`Fetching claims/reimbursements for account ${accountId} from SP-API`, {
        baseUrl: this.baseUrl,
        marketplaceId,
        postedAfter: postedAfter.toISOString(),
        postedBefore: postedBefore.toISOString(),
        isSandbox: this.isSandbox()
      });

      // Use Financial Events API to get reimbursements (claims)
      // Financial Events includes: Reimbursement events, Adjustments, etc.
      const params: any = {
        PostedAfter: postedAfter.toISOString(),
        PostedBefore: postedBefore.toISOString(),
        MarketplaceIds: marketplaceId
      };

      // Check cache for first page (subsequent pages are less cacheable)
      const cacheKey = this.getCacheKey('financialEvents', { ...params, endpoint: 'claims' });
      const cached = this.getCachedResponse(cacheKey);
      if (cached && !params.NextToken) {
        logger.info('Using cached claims data', { itemCount: cached.length });
        return {
          success: true,
          data: cached,
          message: `Fetched ${cached.length} claims/reimbursements from SP-API (cached)`,
          fromApi: true,
          isSandbox: this.isSandbox(),
          cached: true
        };
      }

      let allClaims: any[] = [];
      let nextToken: string | undefined = undefined;
      const rateLimitDelay = this.getRateLimitDelay();

      // Paginate through all financial events
      do {
        if (nextToken) {
          params.NextToken = nextToken;
        }

        const response = await axios.get(
          `${this.baseUrl}/finances/v0/financialEvents`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'x-amz-access-token': accessToken,
              'Content-Type': 'application/json'
            },
            params,
            timeout: 30000
          }
        );

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

      logger.info(`Successfully fetched ${allClaims.length} claims/reimbursements from SP-API`, {
        itemCount: allClaims.length,
        accountId,
        isSandbox: this.isSandbox(),
        cacheUsed: false
      });

      // Cache the first page result
      if (!params.NextToken) {
        this.setCachedResponse(cacheKey, allClaims);
      }

      return { 
        success: true, 
        data: allClaims, 
        message: `Fetched ${allClaims.length} claims/reimbursements from SP-API`,
        fromApi: true,
        isSandbox: this.isSandbox()
      };
    } catch (error: any) {
      const errorDetails = error.response?.data?.errors?.[0] || {};
      logger.error("Error fetching Amazon claims from SP-API:", {
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
      throw new Error(`Failed to fetch claims from SP-API: ${errorMessage}`);
    }
  }

  async fetchInventory(accountId: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken(accountId);
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER';

      logger.info(`Fetching inventory for account ${accountId} from SP-API`, {
        baseUrl: this.baseUrl,
        marketplaceId,
        isSandbox: this.isSandbox()
      });

      // Build params - sandbox may not support granularityType
      const params: any = {
        marketplaceIds: marketplaceId
      };

      // Only include granularityType for production (sandbox may not support it)
      if (!this.isSandbox()) {
        params.granularityType = 'Marketplace';
        params.granularityId = marketplaceId;
      }

      // Make real SP-API call to fetch inventory
      const response = await axios.get(
        `${this.baseUrl}/fba/inventory/v1/summaries`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json'
          },
          params,
          timeout: 30000
        }
      );

      // Handle both production and sandbox response formats
      const payload = response.data?.payload || response.data;
      const summaries = payload?.inventorySummaries || (Array.isArray(payload) ? payload : []);
      
      logger.info(`Successfully fetched ${summaries.length} inventory items from SP-API`, {
        itemCount: summaries.length,
        accountId,
        isSandbox: this.isSandbox()
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
        message: `Fetched ${inventory.length} inventory items from SP-API`,
        fromApi: true,  // Flag to indicate this is real API data, not mock
        isSandbox: this.isSandbox()
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
      
      // Don't silently fall back to mock data - throw error so caller knows
      // This ensures sync jobs can track failures properly
      // For sandbox, provide more helpful error messages
      const errorMessage = errorDetails.message || error.message;
      if (this.isSandbox() && error.response?.status === 400) {
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
      const sellersUrl = `${this.baseUrl}/sellers/v1/marketplaceParticipations`;

      logger.info('Fetching seller information from SP-API', {
        baseUrl: this.baseUrl,
        isSandbox: this.isSandbox()
      });

      const response = await axios.get(sellersUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        },
        timeout: 30000
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
      const params: any = {
        PostedAfter: postedAfter.toISOString(),
        PostedBefore: postedBefore.toISOString(),
        MarketplaceIds: marketplaceId
      };

      // Check cache for first page
      const cacheKey = this.getCacheKey('financialEvents', { ...params, endpoint: 'fees' });
      const cached = this.getCachedResponse(cacheKey);
      if (cached && !params.NextToken) {
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

      let allFees: any[] = [];
      let nextToken: string | undefined = undefined;
      const rateLimitDelay = this.getRateLimitDelay();

      // Paginate through all financial events
      do {
        if (nextToken) {
          params.NextToken = nextToken;
        }

        const response = await axios.get(
          `${this.baseUrl}/finances/v0/financialEvents`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'x-amz-access-token': accessToken,
              'Content-Type': 'application/json'
            },
            params,
            timeout: 30000
          }
        );

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
      if (!params.NextToken) {
        this.setCachedResponse(cacheKey, allFees);
      }

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
}

export default new AmazonService();
