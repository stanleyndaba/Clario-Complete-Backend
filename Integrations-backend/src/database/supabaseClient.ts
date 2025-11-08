import { createClient, SupabaseClient } from '@supabase/supabase-js';
import config from '../config/env';
import logger from '../utils/logger';

const supabaseUrl = config.SUPABASE_URL;
const supabaseAnonKey = config.SUPABASE_ANON_KEY;

// Create a demo client if Supabase config is missing
let supabase: SupabaseClient | any;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('demo-')) {
  logger.warn('Using demo Supabase client - no real database connection');
  
  // Create a mock client that doesn't actually connect
  // This mock properly chains query methods for compatibility
  const createMockQueryBuilder = () => {
    const builder: any = {
      eq: (field: string, value: any) => builder,
      neq: (field: string, value: any) => builder,
      gt: (field: string, value: any) => builder,
      gte: (field: string, value: any) => builder,
      lt: (field: string, value: any) => builder,
      lte: (field: string, value: any) => builder,
      like: (field: string, pattern: string) => builder,
      ilike: (field: string, pattern: string) => builder,
      is: (field: string, value: any) => builder,
      in: (field: string, values: any[]) => builder,
      contains: (field: string, value: any) => builder,
      order: (field: string, options?: any) => builder,
      limit: (count: number) => builder,
      range: (from: number, to: number) => builder,
      single: () => Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'No rows returned' } }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)
    };
    return builder;
  };
  
  supabase = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null })
    },
    from: (table: string) => ({
      select: (columns?: string) => createMockQueryBuilder(),
      insert: (data: any) => ({
        select: (columns?: string) => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
      }),
      upsert: (data: any, options?: any) => ({
        select: (columns?: string) => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
      }),
      update: (data: any) => ({
        eq: (field: string, value: any) => ({
          eq: (field2: string, value2: any) => ({
            select: (columns?: string) => Promise.resolve({ data: null, error: null }),
            then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
          }),
          select: (columns?: string) => Promise.resolve({ data: null, error: null }),
          then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
        }),
        match: (conditions: Record<string, any>) => Promise.resolve({ data: null, error: null }),
        select: (columns?: string) => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
      }),
      delete: () => ({
        eq: (field: string, value: any) => ({
          eq: (field2: string, value2: any) => Promise.resolve({ data: null, error: null }),
          then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
        }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
      })
    })
  } as any;
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  // Test connection on startup
  supabase.auth.getSession().then(({ data, error }: { data: any; error: any }) => {
    if (error) {
      logger.warn('Supabase connection failed', { error: error.message });
    } else {
      logger.info('Supabase connected successfully');
    }
  });
}

export { supabase };

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
      if (typeof supabase.from !== 'function') {
        logger.info('Demo mode: Token save skipped', { userId, provider });
        return;
      }

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
      if (typeof supabase.from !== 'function') {
        logger.info('Demo mode: Returning null token', { userId, provider });
        return null;
      }

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
      if (typeof supabase.from !== 'function') {
        logger.info('Demo mode: Token update skipped', { userId, provider });
        return;
      }

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
      if (typeof supabase.from !== 'function') {
        logger.info('Demo mode: Token delete skipped', { userId, provider });
        return;
      }

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


