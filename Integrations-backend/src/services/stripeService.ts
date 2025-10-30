import axios from 'axios';
import config from '../config/env';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { createError } from '../utils/errorHandler';
import { supabase } from '../database/supabaseClient';

export interface StripeTransaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description?: string;
  customerId?: string;
  paymentMethod?: string;
  created: string;
  updated: string;
  fee?: number;
  net?: number;
  type: 'charge' | 'refund' | 'transfer' | 'fee';
}

export interface StripeAccount {
  id: string;
  businessType: string;
  country: string;
  email: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  defaultCurrency: string;
  created: string;
}

export interface StripeOAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  stripe_user_id: string;
  stripe_publishable_key: string;
}

export async function getStripeAccountStatus(userId: string): Promise<'created' | 'not_found'> {
  const { data, error } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id')
    .eq('user_id', userId)
    .single();
  if (error || !data) return 'not_found';
  return 'created';
}

export class StripeService {
  private baseUrl = 'https://api.stripe.com/v1';
  private authUrl = 'https://connect.stripe.com/oauth/token';

  async initiateOAuth(userId: string): Promise<string> {
    try {
      const authUrl = new URL(config.STRIPE_AUTH_URL!);
      authUrl.searchParams.set('client_id', config.STRIPE_CLIENT_ID!);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', config.STRIPE_REDIRECT_URI!);
      authUrl.searchParams.set('scope', 'read_write');
      authUrl.searchParams.set('state', userId);

      logger.info('Stripe OAuth initiated', { userId });
      return authUrl.toString();
    } catch (error) {
      logger.error('Error initiating Stripe OAuth', { error, userId });
      throw createError('Failed to initiate Stripe OAuth', 500);
    }
  }

  async handleOAuthCallback(code: string, userId: string): Promise<void> {
    try {
      const tokenResponse = await axios.post(this.authUrl, {
        grant_type: 'authorization_code',
        code,
        client_id: config.STRIPE_CLIENT_ID!,
        client_secret: config.STRIPE_CLIENT_SECRET,
        redirect_uri: config.STRIPE_REDIRECT_URI!
      });

      const tokenData: StripeOAuthResponse = tokenResponse.data;
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      await tokenManager.saveToken(userId, 'stripe', {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt
      });

      logger.info('Stripe OAuth completed successfully', { userId });
    } catch (error) {
      const message = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error handling Stripe OAuth callback', { userId, error: message });
      throw createError('Failed to complete Stripe OAuth', 400);
    }
  }

  async refreshAccessToken(userId: string): Promise<string> {
    try {
      const tokenData = await tokenManager.getToken(userId, 'stripe');
      if (!tokenData) {
        throw createError('No Stripe token found', 401);
      }

      const response = await axios.post(this.authUrl, {
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken,
        client_id: config.STRIPE_CLIENT_ID!,
        client_secret: config.STRIPE_CLIENT_SECRET
      });

      const newTokenData: StripeOAuthResponse = response.data;
      const expiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);

      await tokenManager.refreshToken(userId, 'stripe', {
        accessToken: newTokenData.access_token,
        refreshToken: newTokenData.refresh_token,
        expiresAt
      });

      logger.info('Stripe access token refreshed', { userId });
      return newTokenData.access_token;
    } catch (error) {
      logger.error('Error refreshing Stripe access token', { error, userId });
      throw createError('Failed to refresh Stripe access token', 500);
    }
  }

  async getValidAccessToken(userId: string): Promise<string> {
    try {
      const tokenData = await tokenManager.getToken(userId, 'stripe');
      if (!tokenData) {
        throw createError('No Stripe token found', 401);
      }

      // Check if token is expired or will expire soon (within 5 minutes)
      const expiresIn = tokenData.expiresAt.getTime() - Date.now();
      if (expiresIn < 300000) { // 5 minutes
        return await this.refreshAccessToken(userId);
      }

      return tokenData.accessToken;
    } catch (error) {
      logger.error('Error getting valid Stripe access token', { error, userId });
      throw error;
    }
  }

  // STUB FUNCTION: Connect Stripe account
  async connectStripe(userId: string): Promise<{ success: boolean; message: string; authUrl?: string }> {
    try {
      const isConnected = await tokenManager.isTokenValid(userId, 'stripe');
      
      if (isConnected) {
        const authUrl = await this.initiateOAuth(userId);
        return { success: true, authUrl: authUrl.toString(), message: 'Stripe already connected' };
      }

      const authUrl = await this.initiateOAuth(userId);
      
      logger.info('Stripe connection initiated', { userId });
      return { success: true, authUrl: authUrl.toString(), message: 'Stripe connection initiated' };
    } catch (error) {
      logger.error('Error connecting Stripe', { error, userId });
      throw createError('Failed to connect Stripe', 500);
    }
  }

  // STUB FUNCTION: Fetch transactions from Stripe
  async fetchTransactions(
    userId: string,
    startDate?: string,
    endDate?: string,
    limit: number = 10
  ): Promise<StripeTransaction[]> {
    try {
      const accessToken = await this.getValidAccessToken(userId);
      
      // TODO: Implement actual Stripe API call to fetch transactions
      // This is a stub implementation
      logger.info('Fetching Stripe transactions', { userId, startDate, endDate, limit });
      
      // Mock response for development
      const mockTransactions: StripeTransaction[] = [
        {
          id: 'txn_1',
          amount: 2999, // $29.99 in cents
          currency: 'usd',
          status: 'succeeded',
          description: 'Product purchase',
          customerId: 'cus_123456',
          paymentMethod: 'card_123456',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          fee: 87, // $0.87 in cents
          net: 2912, // $29.12 in cents
          type: 'charge'
        },
        {
          id: 'txn_2',
          amount: 1500, // $15.00 in cents
          currency: 'usd',
          status: 'succeeded',
          description: 'Subscription payment',
          customerId: 'cus_789012',
          paymentMethod: 'card_789012',
          created: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          updated: new Date(Date.now() - 86400000).toISOString(),
          fee: 43, // $0.43 in cents
          net: 1457, // $14.57 in cents
          type: 'charge'
        }
      ];

      logger.info('Stripe transactions fetched successfully', { userId, count: mockTransactions.length });
      return mockTransactions;
    } catch (error) {
      logger.error('Error fetching Stripe transactions', { error, userId });
      throw createError('Failed to fetch Stripe transactions', 500);
    }
  }

  // STUB FUNCTION: Get account information
  async getAccountInfo(userId: string): Promise<StripeAccount> {
    try {
      const accessToken = await this.getValidAccessToken(userId);
      
      // TODO: Implement actual Stripe API call to get account info
      // This is a stub implementation
      logger.info('Fetching Stripe account info', { userId });
      
      // Mock response for development
      const mockAccount: StripeAccount = {
        id: 'acct_1234567890',
        businessType: 'individual',
        country: 'US',
        email: 'user@example.com',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        defaultCurrency: 'usd',
        created: new Date().toISOString()
      };

      logger.info('Stripe account info fetched successfully', { userId });
      return mockAccount;
    } catch (error) {
      logger.error('Error fetching Stripe account info', { error, userId });
      throw createError('Failed to fetch Stripe account info', 500);
    }
  }

  // STUB FUNCTION: Get transaction by ID
  async getTransaction(userId: string, transactionId: string): Promise<StripeTransaction> {
    try {
      const accessToken = await this.getValidAccessToken(userId);
      
      // TODO: Implement actual Stripe API call to get specific transaction
      // This is a stub implementation
      logger.info('Fetching Stripe transaction', { userId, transactionId });
      
      // Mock response for development
      const mockTransaction: StripeTransaction = {
        id: transactionId,
        amount: 5000, // $50.00 in cents
        currency: 'usd',
        status: 'succeeded',
        description: 'Detailed transaction information',
        customerId: 'cus_123456',
        paymentMethod: 'card_123456',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        fee: 145, // $1.45 in cents
        net: 4855, // $48.55 in cents
        type: 'charge'
      };

      logger.info('Stripe transaction fetched successfully', { userId, transactionId });
      return mockTransaction;
    } catch (error) {
      logger.error('Error fetching Stripe transaction', { error, userId, transactionId });
      throw createError('Failed to fetch Stripe transaction', 500);
    }
  }

  async disconnect(userId: string): Promise<void> {
    try {
      await tokenManager.revokeToken(userId, 'stripe');
      logger.info('Stripe integration disconnected', { userId });
    } catch (error) {
      logger.error('Error disconnecting Stripe integration', { error, userId });
      throw createError('Failed to disconnect Stripe integration', 500);
    }
  }

  // STUB FUNCTION: Create silent Stripe Connect account
  async createSilentConnectAccount(userId: string): Promise<StripeAccount> {
    try {
      logger.info('Creating silent Stripe Connect account', { userId });
      
      // TODO: Implement actual Stripe Connect account creation
      // This would use Stripe's Connect API to create an account without OAuth
      // For now, using mock data
      
      const mockAccount: StripeAccount = {
        id: `acct_${Math.random().toString(36).substr(2, 9)}`,
        businessType: 'individual',
        country: 'US',
        email: 'user@example.com',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        defaultCurrency: 'usd',
        created: new Date().toISOString()
      };

      logger.info('Silent Stripe Connect account created', { userId, accountId: mockAccount.id });
      return mockAccount;
    } catch (error) {
      logger.error('Error creating silent Stripe Connect account', { error, userId });
      throw createError('Failed to create Stripe Connect account', 500);
    }
  }
}

export const stripeService = new StripeService();
export default stripeService; 


