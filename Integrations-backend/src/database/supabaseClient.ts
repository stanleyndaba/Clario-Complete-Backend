import { createClient, SupabaseClient } from '@supabase/supabase-js';
import config from '../config/env';
import logger from '../utils/logger';

const supabaseUrl = config.SUPABASE_URL;
const supabaseAnonKey = config.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = config.SUPABASE_SERVICE_ROLE_KEY;

// Create a demo client if Supabase config is missing
let supabase: SupabaseClient | any;
let supabaseAdmin: SupabaseClient | any; // Service role client for admin operations

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
      not: (field: string, operator: string, value: any) => builder, // Add .not() method
      in: (field: string, values: any[]) => builder,
      contains: (field: string, value: any) => builder,
      order: (field: string, options?: any) => builder,
      limit: (count: number) => builder,
      range: (from: number, to: number) => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
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
      select: (columns?: string, options?: any) => createMockQueryBuilder(),
      insert: (data: any) => ({
        select: (columns?: string) => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
      }),
      upsert: (data: any, options?: any) => ({
        select: (columns?: string) => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
      }),
      update: (data: any) => createMockQueryBuilder(), // Use query builder for update chains
      delete: () => createMockQueryBuilder() // Use query builder for delete chains
    })
  } as any;
} else {
  // Validate URL before creating client
  if (!supabaseUrl || typeof supabaseUrl !== 'string' || !supabaseUrl.startsWith('http')) {
    logger.error('Invalid SUPABASE_URL - must be a valid HTTP/HTTPS URL', { 
      url: supabaseUrl ? 'present but invalid' : 'missing' 
    });
    throw new Error('SUPABASE_URL must be a valid HTTP or HTTPS URL. Please set it in environment variables.');
  }
  
  if (!supabaseAnonKey || typeof supabaseAnonKey !== 'string') {
    logger.error('Invalid SUPABASE_ANON_KEY - must be a non-empty string', { 
      key: supabaseAnonKey ? 'present but invalid' : 'missing' 
    });
    throw new Error('SUPABASE_ANON_KEY must be set in environment variables.');
  }
  
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  // Create admin client with service role key for storage/admin operations
  if (supabaseServiceRoleKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    logger.info('Supabase admin client created (for storage operations)');
  } else {
    logger.warn('SUPABASE_SERVICE_ROLE_KEY not set - admin operations may be limited');
  }
  
  // Test connection on startup
  supabase.auth.getSession().then(({ data, error }: { data: any; error: any }) => {
    if (error) {
      logger.warn('Supabase connection failed', { error: error.message });
    } else {
      logger.info('Supabase connected successfully');
    }
  });
}

export { supabase, supabaseAdmin };

// Database types
export interface EncryptedToken {
  iv: string;
  data: string;
}

export interface TokenRecord {
  id: string;
  user_id: string;
  provider: 'amazon' | 'gmail' | 'stripe';
  access_token_iv?: string;
  access_token_data?: string;
  refresh_token_iv?: string;
  refresh_token_data?: string;
  // Legacy format support
  access_token?: string | EncryptedToken;
  refresh_token?: string | EncryptedToken;
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
    accessTokenEnc: { iv: string; data: string },
    refreshTokenEnc?: { iv: string; data: string },
    expiresAt?: Date
  ): Promise<void> {
    try {
      if (typeof supabase.from !== 'function') {
        logger.info('Demo mode: Token save skipped', { userId, provider });
        return;
      }

      // Use supabaseAdmin to bypass RLS for backend operations
      const adminClient = supabaseAdmin || supabase;

      const { error } = await adminClient
        .from('tokens')
        .upsert({
          user_id: userId,
          provider,
          access_token_iv: accessTokenEnc.iv,
          access_token_data: accessTokenEnc.data,
          refresh_token_iv: refreshTokenEnc?.iv || null,
          refresh_token_data: refreshTokenEnc?.data || null,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
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

      // Use supabaseAdmin to bypass RLS for backend operations
      const adminClient = supabaseAdmin || supabase;

      const { data, error } = await adminClient
        .from('tokens')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', provider)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        logger.error('Error getting token', { error, userId, provider });
        throw new Error('Failed to get token');
      }

      if (!data) {
        return null;
      }

      // Return in format expected by tokenManager (with IV+data fields)
      return {
        id: data.id,
        user_id: data.user_id,
        provider: data.provider,
        access_token_iv: data.access_token_iv,
        access_token_data: data.access_token_data,
        refresh_token_iv: data.refresh_token_iv,
        refresh_token_data: data.refresh_token_data,
        expires_at: data.expires_at,
        created_at: data.created_at,
        updated_at: data.updated_at
      };
    } catch (error) {
      logger.error('Error in getToken', { error, userId, provider });
      throw error;
    }
  },

  async updateToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe',
    accessTokenEnc: { iv: string; data: string },
    refreshTokenEnc?: { iv: string; data: string },
    expiresAt?: Date
  ): Promise<void> {
    try {
      if (typeof supabase.from !== 'function') {
        logger.info('Demo mode: Token update skipped', { userId, provider });
        return;
      }

      // Use supabaseAdmin to bypass RLS for backend operations
      const adminClient = supabaseAdmin || supabase;

      const { error } = await adminClient
        .from('tokens')
        .update({
          access_token_iv: accessTokenEnc.iv,
          access_token_data: accessTokenEnc.data,
          refresh_token_iv: refreshTokenEnc?.iv || null,
          refresh_token_data: refreshTokenEnc?.data || null,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
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


