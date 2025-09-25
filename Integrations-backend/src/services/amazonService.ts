import axios from 'axios';
import config from '../config/env';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { createError } from '../utils/errorHandler';
import { createStateValidator } from '../utils/stateValidator';
import { encryptToken, decryptToken } from '../utils/tokenCrypto';
import { getRedisClient } from '../utils/redisClient';
import { withRetry } from '../utils/retry';

export interface AmazonClaim {
  id: string;
  claimId: string;
  claimType: string;
  claimStatus: string;
  claimAmount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

export interface AmazonInventory {
  id: string;
  sku: string;
  asin: string;
  title: string;
  quantity: number;
  price: number;
  currency: string;
  condition: string;
  lastUpdated: string;
}

export interface AmazonFee {
  id: string;
  feeType: string;
  feeAmount: number;
  currency: string;
  orderId?: string;
  sku?: string;
  date: string;
  description?: string;
}

export interface AmazonOAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export class AmazonService {
  private baseUrl = 'https://sellingpartnerapi-na.amazon.com';
  private authUrl = 'https://api.amazon.com/auth/o2/token';

  async initiateOAuth(userId: string): Promise<string> {
    try {
      // Generate secure OAuth state
      const redisClient = await getRedisClient();
      const stateValidator = createStateValidator(redisClient);
      const state = await stateValidator.generateState(userId);

      const authUrl = new URL(config.AMAZON_AUTH_URL);
      authUrl.searchParams.set('client_id', config.AMAZON_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', config.AMAZON_REDIRECT_URI);
      authUrl.searchParams.set('scope', 'sellingpartnerapi::notifications sellingpartnerapi::migration');
      authUrl.searchParams.set('state', state);

      logger.info('Amazon OAuth initiated with secure state', { userId, state });
      return authUrl.toString();
    } catch (error) {
      logger.error('Error initiating Amazon OAuth', { error, userId });
      throw createError('Failed to initiate Amazon OAuth', 500);
    }
  }

  async handleOAuthCallback(code: string, userId: string): Promise<void> {
    try {
      const tokenResponse = await withRetry(() => axios.post(this.authUrl, {
        grant_type: 'authorization_code',
        code,
        client_id: config.AMAZON_CLIENT_ID,
        client_secret: config.AMAZON_CLIENT_SECRET,
        redirect_uri: config.AMAZON_REDIRECT_URI
      }), { retries: 3, minDelayMs: 300, maxDelayMs: 2500 });

      const tokenData: AmazonOAuthResponse = tokenResponse.data;
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      // Encrypt tokens before saving
      const encryptedAccessToken = encryptToken(tokenData.access_token);
      const encryptedRefreshToken = encryptToken(tokenData.refresh_token);

      await tokenManager.saveToken(userId, 'amazon', {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt
      });

      // Mark integration status active
      await this.upsertIntegrationStatus(userId, 'active', { source: 'oauth_callback' });

      logger.info('Amazon OAuth completed successfully', { userId });
    } catch (error) {
      const message = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error handling Amazon OAuth callback', { userId, error: message });
      throw createError('Failed to complete Amazon OAuth', 400);
    }
  }

  async refreshAccessToken(userId: string): Promise<string> {
    try {
      const tokenData = await tokenManager.getToken(userId, 'amazon');
      if (!tokenData) {
        throw createError('No Amazon token found', 401);
      }

      // Decrypt tokens before using
      const decryptedRefreshToken = decryptToken(tokenData.refreshToken);

      const response = await withRetry(() => axios.post(this.authUrl, {
        grant_type: 'refresh_token',
        refresh_token: decryptedRefreshToken,
        client_id: config.AMAZON_CLIENT_ID,
        client_secret: config.AMAZON_CLIENT_SECRET
      }), { retries: 3, minDelayMs: 300, maxDelayMs: 2500 });

      const newTokenData: AmazonOAuthResponse = response.data;
      const expiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);

      // Encrypt new tokens before saving
      const encryptedAccessToken = encryptToken(newTokenData.access_token);
      const encryptedRefreshToken = encryptToken(newTokenData.refresh_token);

      await tokenManager.refreshToken(userId, 'amazon', {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt
      });

      logger.info('Amazon access token refreshed', { userId });
      await this.upsertIntegrationStatus(userId, 'active', { source: 'refresh' });
      return newTokenData.access_token;
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.warn('Error refreshing Amazon access token', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'revoked', { source: 'refresh_401', error: errMsg });
        throw createError('Amazon token revoked. Please reconnect your account.', 401);
      }
      throw createError('Failed to refresh Amazon access token', 500);
    }
  }

  async getValidAccessToken(userId: string): Promise<string> {
    try {
      const tokenData = await tokenManager.getToken(userId, 'amazon');
      if (!tokenData) {
        throw createError('No Amazon token found', 401);
      }

      // Check if token is expired or will expire soon (within 5 minutes)
      const expiresIn = tokenData.expiresAt.getTime() - Date.now();
      if (expiresIn < 300000) { // 5 minutes
        return await this.refreshAccessToken(userId);
      }

      // Decrypt access token before returning
      return decryptToken(tokenData.accessToken);
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.warn('Error getting valid Amazon access token', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'expired', { source: 'getValidAccessToken_401', error: errMsg });
      }
      throw error;
    }
  }

  // STUB FUNCTION: Fetch claims from Amazon SP-API
  async fetchClaims(userId: string, startDate?: string, endDate?: string): Promise<AmazonClaim[]> {
    try {
      const accessToken = await this.getValidAccessToken(userId);
      
      // TODO: Implement actual Amazon SP-API call to fetch claims
      // This is a stub implementation
      logger.info('Fetching Amazon claims', { userId, startDate, endDate });
      
      // Mock response for development
      const mockClaims: AmazonClaim[] = [
        {
          id: 'claim-1',
          claimId: 'AMZ-CLAIM-001',
          claimType: 'reimbursement',
          claimStatus: 'approved',
          claimAmount: 150.00,
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          description: 'Reimbursement for damaged item'
        }
      ];

      logger.info('Amazon claims fetched successfully', { userId, count: mockClaims.length });
      return mockClaims;
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error fetching Amazon claims', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'revoked', { source: 'claims_401', error: errMsg });
        throw createError('Amazon permissions revoked. Please reconnect.', 401);
      }
      throw createError('Failed to fetch Amazon claims', 500);
    }
  }

  // STUB FUNCTION: Fetch inventory from Amazon SP-API
  async fetchInventory(userId: string, marketplaceId?: string): Promise<AmazonInventory[]> {
    try {
      const accessToken = await this.getValidAccessToken(userId);
      
      // TODO: Implement actual Amazon SP-API call to fetch inventory
      // This is a stub implementation
      logger.info('Fetching Amazon inventory', { userId, marketplaceId });
      
      // Mock response for development
      const mockInventory: AmazonInventory[] = [
        {
          id: 'inv-1',
          sku: 'PRODUCT-001',
          asin: 'B08N5WRWNW',
          title: 'Sample Product',
          quantity: 50,
          price: 29.99,
          currency: 'USD',
          condition: 'New',
          lastUpdated: new Date().toISOString()
        }
      ];

      logger.info('Amazon inventory fetched successfully', { userId, count: mockInventory.length });
      return mockInventory;
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error fetching Amazon inventory', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'revoked', { source: 'inventory_401', error: errMsg });
        throw createError('Amazon permissions revoked. Please reconnect.', 401);
      }
      throw createError('Failed to fetch Amazon inventory', 500);
    }
  }

  // STUB FUNCTION: Fetch fees from Amazon SP-API
  async fetchFees(userId: string, startDate?: string, endDate?: string): Promise<AmazonFee[]> {
    try {
      const accessToken = await this.getValidAccessToken(userId);
      
      // TODO: Implement actual Amazon SP-API call to fetch fees
      // This is a stub implementation
      logger.info('Fetching Amazon fees', { userId, startDate, endDate });
      
      // Mock response for development
      const mockFees: AmazonFee[] = [
        {
          id: 'fee-1',
          feeType: 'referral',
          feeAmount: 2.99,
          currency: 'USD',
          orderId: 'ORDER-001',
          sku: 'PRODUCT-001',
          date: new Date().toISOString(),
          description: 'Referral fee for product sale'
        }
      ];

      logger.info('Amazon fees fetched successfully', { userId, count: mockFees.length });
      return mockFees;
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error fetching Amazon fees', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'revoked', { source: 'fees_401', error: errMsg });
        throw createError('Amazon permissions revoked. Please reconnect.', 401);
      }
      throw createError('Failed to fetch Amazon fees', 500);
    }
  }

  private async upsertIntegrationStatus(userId: string, status: 'active'|'revoked'|'expired', metadata?: any) {
    try {
      const { supabase } = await import('../database/supabaseClient');
      await supabase
        .from('integration_status')
        .upsert({ user_id: userId, provider: 'amazon', status, updated_at: new Date().toISOString(), metadata }, { onConflict: 'user_id,provider' });
    } catch (e) {
      logger.warn('Failed to upsert integration status', { userId, status, error: (e as Error).message });
    }
  }

  async disconnect(userId: string): Promise<void> {
    try {
      await tokenManager.revokeToken(userId, 'amazon');
      logger.info('Amazon integration disconnected', { userId });
    } catch (error) {
      logger.error('Error disconnecting Amazon integration', { error, userId });
      throw createError('Failed to disconnect Amazon integration', 500);
    }
  }
}

export const amazonService = new AmazonService();
export default amazonService; 