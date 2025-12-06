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

  // In-memory store for demo mode
  const memoryStore: Record<string, any[]> = {
    documents: [],
    dispute_cases: [],
    recoveries: [],
    tokens: [],
    agent_events: [],
    learning_insights: [],
    threshold_optimizations: [],
    dispute_evidence_links: [],
    financial_events: [],
    notifications: [],
    recovery_lifecycle_logs: [],
    detection_results: []
  };

  logger.info('Using in-memory mock database for demo mode');

  const createMockQueryBuilder = (table: string) => {
    // Initialize table if not exists
    if (!memoryStore[table]) memoryStore[table] = [];

    // State for the query builder
    let filters: Array<(row: any) => boolean> = [];
    let pendingUpdate: any = null;
    let pendingDelete = false;
    let pendingInsert: any = null;
    let limitCount = -1;
    let orderConfig: { field: string, ascending: boolean } | null = null;
    let singleResult = false;
    let maybeSingleResult = false;

    const builder: any = {
      select: (columns?: string) => builder,

      // Filters
      eq: (field: string, value: any) => {
        filters.push(row => row[field] === value);
        return builder;
      },
      neq: (field: string, value: any) => {
        filters.push(row => row[field] !== value);
        return builder;
      },
      gt: (field: string, value: any) => {
        filters.push(row => row[field] > value);
        return builder;
      },
      gte: (field: string, value: any) => {
        filters.push(row => row[field] >= value);
        return builder;
      },
      lt: (field: string, value: any) => {
        filters.push(row => row[field] < value);
        return builder;
      },
      lte: (field: string, value: any) => {
        filters.push(row => row[field] <= value);
        return builder;
      },
      in: (field: string, values: any[]) => {
        filters.push(row => values.includes(row[field]));
        return builder;
      },

      // Modifiers
      order: (field: string, options?: any) => {
        orderConfig = { field, ascending: options?.ascending !== false };
        return builder;
      },
      limit: (count: number) => {
        limitCount = count;
        return builder;
      },
      single: () => {
        singleResult = true;
        return builder;
      },
      maybeSingle: () => {
        maybeSingleResult = true;
        return builder;
      },

      // Actions
      insert: (data: any) => {
        pendingInsert = data;
        return builder;
      },
      update: (data: any) => {
        pendingUpdate = data;
        return builder;
      },
      delete: () => {
        pendingDelete = true;
        return builder;
      },

      // Execution
      then: (resolve: any, reject: any) => {
        // 1. Handle Insert (doesn't use filters usually)
        if (pendingInsert) {
          const rows = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
          const now = new Date().toISOString();
          const rowsWithMeta = rows.map(r => ({
            created_at: now,
            updated_at: now,
            ...r
          }));
          memoryStore[table].push(...rowsWithMeta);
          return Promise.resolve({ data: rowsWithMeta, error: null }).then(resolve, reject);
        }

        // 2. Apply Filters to get target rows
        let resultData = [...memoryStore[table]];
        for (const filter of filters) {
          resultData = resultData.filter(filter);
        }

        // 3. Handle Update
        if (pendingUpdate) {
          const idsToUpdate = new Set(resultData.map(r => r.id).filter(id => id));
          let updateCount = 0;

          memoryStore[table] = memoryStore[table].map(row => {
            if (idsToUpdate.has(row.id)) {
              updateCount++;
              return { ...row, ...pendingUpdate, updated_at: new Date().toISOString() };
            }
            return row;
          });

          // Return the updated data (simulated)
          const updatedRows = memoryStore[table].filter(row => idsToUpdate.has(row.id));
          return Promise.resolve({ data: updatedRows, error: null, count: updateCount }).then(resolve, reject);
        }

        // 4. Handle Delete
        if (pendingDelete) {
          const idsToDelete = new Set(resultData.map(r => r.id).filter(id => id));
          const initialLength = memoryStore[table].length;
          memoryStore[table] = memoryStore[table].filter(row => !idsToDelete.has(row.id));
          return Promise.resolve({ data: null, error: null, count: initialLength - memoryStore[table].length }).then(resolve, reject);
        }

        // 5. Handle Select (Sorting & Limiting)
        if (orderConfig) {
          const { field, ascending } = orderConfig;
          resultData.sort((a, b) => {
            if (a[field] < b[field]) return ascending ? -1 : 1;
            if (a[field] > b[field]) return ascending ? 1 : -1;
            return 0;
          });
        }

        if (limitCount > -1) {
          resultData = resultData.slice(0, limitCount);
        }

        // 6. Handle Single/MaybeSingle
        if (singleResult) {
          if (resultData.length === 0) {
            return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'No rows returned' } }).then(resolve, reject);
          }
          if (resultData.length > 1) {
            return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'Multiple rows returned' } }).then(resolve, reject);
          }
          return Promise.resolve({ data: resultData[0], error: null }).then(resolve, reject);
        }

        if (maybeSingleResult) {
          return Promise.resolve({ data: resultData.length > 0 ? resultData[0] : null, error: null }).then(resolve, reject);
        }

        return Promise.resolve({ data: resultData, error: null }).then(resolve, reject);
      }
    };
    return builder;
  };

  supabase = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null })
    },
    from: (table: string) => createMockQueryBuilder(table)
  } as any;

  // In demo mode, admin client is same as regular client
  supabaseAdmin = supabase;
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

  // Prefer admin client for backend operations when available (bypass RLS)
  if (supabaseAdmin) {
    supabase = supabaseAdmin;
    logger.info('Using Supabase admin client for backend operations');
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
  provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox';
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

// Helper function to convert non-UUID user IDs to deterministic UUIDs
// This is needed because the tokens table requires UUID format
export function convertUserIdToUuid(userId: string): string {
  // UUID regex pattern (matches standard UUID format)
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  // First, try to extract a valid UUID from the userId string
  // This handles cases like "stress-test-user-2cdd1838-efe0-4549-a9b0-a88752846dc6"
  const uuidMatch = userId.match(uuidRegex);
  if (uuidMatch) {
    // Found a valid UUID in the string - use it directly
    const extractedUuid = uuidMatch[0];
    if (extractedUuid !== userId) {
      logger.debug('Extracted UUID from prefixed userId', {
        originalUserId: userId,
        extractedUuid
      });
    }
    return extractedUuid;
  }

  // No valid UUID found - generate a deterministic UUID from the userId
  // This handles legacy cases like "demo-user", "test-user", etc.
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(`clario-user-${userId}`).digest('hex');
  const generatedUuid = `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;

  logger.debug('Generated deterministic UUID for non-UUID userId', {
    originalUserId: userId,
    generatedUuid
  });

  return generatedUuid;
}

// Database operations
export const tokenManager = {
  async saveToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
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

      // Convert non-UUID user IDs to a consistent UUID format
      // The tokens table requires a UUID, so we need to handle demo-user and other non-UUID IDs
      const dbUserId = convertUserIdToUuid(userId);
      if (dbUserId !== userId) {
        logger.info('Converted non-UUID userId to deterministic UUID', { originalUserId: userId, dbUserId, provider });
      }

      const { error } = await adminClient
        .from('tokens')
        .upsert({
          user_id: dbUserId,
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
        logger.error('Error saving token', { error, userId, dbUserId, provider });
        throw new Error('Failed to save token');
      }

      logger.info('Token saved successfully', { userId, dbUserId, provider });
    } catch (error) {
      logger.error('Error in saveToken', { error, userId, provider });
      throw error;
    }
  },

  async getToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox'
  ): Promise<TokenRecord | null> {
    try {
      if (typeof supabase.from !== 'function') {
        logger.info('Demo mode: Returning null token', { userId, provider });
        return null;
      }

      // Use supabaseAdmin to bypass RLS for backend operations
      const adminClient = supabaseAdmin || supabase;

      // Convert non-UUID user IDs to the same deterministic UUID format used in saveToken
      const dbUserId = convertUserIdToUuid(userId);

      const { data, error } = await adminClient
        .from('tokens')
        .select('*')
        .eq('user_id', dbUserId)
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
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
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

      // Convert non-UUID user IDs to deterministic UUID
      const dbUserId = convertUserIdToUuid(userId);

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
        .eq('user_id', dbUserId)
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
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox'
  ): Promise<void> {
    try {
      if (typeof supabase.from !== 'function') {
        logger.info('Demo mode: Token delete skipped', { userId, provider });
        return;
      }

      // Convert non-UUID user IDs to deterministic UUID
      const dbUserId = convertUserIdToUuid(userId);

      const { error } = await supabase
        .from('tokens')
        .delete()
        .eq('user_id', dbUserId)
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
