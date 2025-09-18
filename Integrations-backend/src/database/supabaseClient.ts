import { createClient } from '@supabase/supabase-js';
import config from '../config/env';
import logger from '../utils/logger';

const supabaseUrl = config.SUPABASE_URL;
const supabaseAnonKey = config.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database types
export interface TokenRecord {
  id: string;
  user_id: string;
  provider: 'amazon' | 'gmail' | 'stripe';
  access_token: string;
  refresh_token: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

// Database operations
export const tokenManager = {
  async saveToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe',
    accessToken: string,
    refreshToken: string,
    expiresAt: Date
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('tokens')
        .upsert({
          user_id: userId,
          provider,
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,provider'
        });

      if (error) {
        logger.error('Error saving token', { error, userId, provider });
        throw new Error('Failed to save token');
      }

      logger.info('Token saved successfully', { userId, provider });
    } catch (error) {
      logger.error('Error in saveToken', { error, userId, provider });
      throw error;
    }
  },

  async getToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe'
  ): Promise<TokenRecord | null> {
    try {
      const { data, error } = await supabase
        .from('tokens')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', provider)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        logger.error('Error getting token', { error, userId, provider });
        throw new Error('Failed to get token');
      }

      return data;
    } catch (error) {
      logger.error('Error in getToken', { error, userId, provider });
      throw error;
    }
  },

  async updateToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe',
    accessToken: string,
    refreshToken: string,
    expiresAt: Date
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('tokens')
        .update({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('provider', provider);

      if (error) {
        logger.error('Error updating token', { error, userId, provider });
        throw new Error('Failed to update token');
      }

      logger.info('Token updated successfully', { userId, provider });
    } catch (error) {
      logger.error('Error in updateToken', { error, userId, provider });
      throw error;
    }
  },

  async deleteToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe'
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('tokens')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider);

      if (error) {
        logger.error('Error deleting token', { error, userId, provider });
        throw new Error('Failed to delete token');
      }

      logger.info('Token deleted successfully', { userId, provider });
    } catch (error) {
      logger.error('Error in deleteToken', { error, userId, provider });
      throw error;
    }
  },

  async isTokenExpired(token: TokenRecord): Promise<boolean> {
    const expiresAt = new Date(token.expires_at);
    const now = new Date();
    return expiresAt <= now;
  }
};

export default supabase; 