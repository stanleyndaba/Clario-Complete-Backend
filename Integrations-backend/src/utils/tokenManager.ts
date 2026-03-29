import crypto from 'crypto';
import config from '../config/env';
import logger from './logger';
import { tokenManager as dbTokenManager, TokenRecord } from '../database/supabaseClient';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface TokenWithStatus {
  token: TokenData;
  isExpired: boolean;
}

export interface EncryptedToken {
  iv: string;
  data: string;
}

export class TokenManager {
  private encryptionKey: Buffer;

  constructor() {
    const keyHex = process.env.ENCRYPTION_KEY;
    let encryptionKey: Buffer;

    if (keyHex && keyHex.length >= 64) {
      // Use provided hex key
      encryptionKey = Buffer.from(keyHex, 'hex');
    } else {
      // Derive from JWT_SECRET with PBKDF2 for deterministic fallback (not recommended for prod)
      const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-please-set';
      encryptionKey = crypto.pbkdf2Sync(jwtSecret, 'clario-salt', 100000, 32, 'sha256');
      logger.warn('ENCRYPTION_KEY missing or too short; using derived key from JWT_SECRET. Set ENCRYPTION_KEY for production.');
    }

    this.encryptionKey = encryptionKey;
  }

  private encrypt(text: string): EncryptedToken {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
      let encrypted = cipher.update(text, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return { iv: iv.toString('base64'), data: encrypted };
    } catch (err: any) {
      logger.error('Encryption failed', { error: err.message });
      throw err;
    }
  }

  private decrypt(ivBase64: string, data: string): string {
    try {
      const iv = Buffer.from(ivBase64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      let dec = decipher.update(data, 'base64', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    } catch (err: any) {
      logger.error('Decryption failed', { error: err.message });
      throw err;
    }
  }

  async saveToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
    tokenData: TokenData,
    tenantId?: string,
    storeId?: string
  ): Promise<void> {
    try {
      const encryptedAccessToken = this.encrypt(tokenData.accessToken);
      const encryptedRefreshToken = tokenData.refreshToken ? this.encrypt(tokenData.refreshToken) : undefined;

      await dbTokenManager.saveToken(
        userId,
        provider,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenData.expiresAt,
        tenantId,
        storeId
      );

      logger.info('Token saved successfully', { userId, provider });
    } catch (error) {
      logger.error('Error saving token', { error, userId, provider });
      throw error;
    }
  }

  async getToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
    storeId?: string
  ): Promise<TokenData | null> {
    try {
      const tokenStatus = await this.getTokenWithStatus(userId, provider, storeId);

      if (!tokenStatus) {
        return null;
      }

      if (tokenStatus.isExpired) {
        logger.info('Token is expired', { userId, provider });
        return null;
      }

      return tokenStatus.token;
    } catch (error) {
      logger.error('Error getting token', { error, userId, provider });
      throw error;
    }
  }

  async getRefreshableToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
    storeId?: string
  ): Promise<TokenData | null> {
    try {
      const tokenStatus = await this.getTokenWithStatus(userId, provider, storeId);

      if (!tokenStatus) {
        return null;
      }

      // A token that can be refreshed is still usable for long-running integrations,
      // even if the short-lived access token itself has expired.
      if (!tokenStatus.isExpired || tokenStatus.token.refreshToken) {
        return tokenStatus.token;
      }

      return null;
    } catch (error) {
      logger.error('Error getting refreshable token', { error, userId, provider });
      throw error;
    }
  }

  async getTokenWithStatus(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
    storeId?: string
  ): Promise<TokenWithStatus | null> {
    try {
      const tokenRecord = await dbTokenManager.getToken(userId, provider, storeId);

      if (!tokenRecord) {
        return null;
      }

      const tokenData = this.decryptTokenRecord(tokenRecord);
      const isExpired = await dbTokenManager.isTokenExpired(tokenRecord);

      return {
        token: tokenData,
        isExpired
      };
    } catch (error) {
      logger.error('Error getting token with status', { error, userId, provider });
      throw error;
    }
  }

  private decryptTokenRecord(tokenRecord: TokenRecord): TokenData {
    // Handle both old format (colon-separated) and new format (IV+data)
    let decryptedAccessToken: string;
    let decryptedRefreshToken: string;

    if (typeof tokenRecord.access_token === 'string' && tokenRecord.access_token.includes(':')) {
      // Old format: colon-separated IV:data
      const textParts = tokenRecord.access_token.split(':');
      const iv = Buffer.from(textParts.shift()!, 'hex');
      const encrypted = textParts.join(':');
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      let dec = decipher.update(encrypted, 'hex', 'utf8');
      dec += decipher.final('utf8');
      decryptedAccessToken = dec;
    } else if (typeof tokenRecord.access_token === 'object' && tokenRecord.access_token.iv && tokenRecord.access_token.data) {
      // New format: {iv, data}
      decryptedAccessToken = this.decrypt(tokenRecord.access_token.iv, tokenRecord.access_token.data);
    } else {
      // Assume it's already in IV+data format from database
      decryptedAccessToken = this.decrypt((tokenRecord as any).access_token_iv, (tokenRecord as any).access_token_data);
    }

    // Check if we have refresh token data in any format
    if (tokenRecord.refresh_token) {
      if (typeof tokenRecord.refresh_token === 'string' && tokenRecord.refresh_token.includes(':')) {
        // Old format
        const textParts = tokenRecord.refresh_token.split(':');
        const iv = Buffer.from(textParts.shift()!, 'hex');
        const encrypted = textParts.join(':');
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
        let dec = decipher.update(encrypted, 'hex', 'utf8');
        dec += decipher.final('utf8');
        decryptedRefreshToken = dec;
      } else if (typeof tokenRecord.refresh_token === 'object' && tokenRecord.refresh_token.iv && tokenRecord.refresh_token.data) {
        // New format
        decryptedRefreshToken = this.decrypt(tokenRecord.refresh_token.iv, tokenRecord.refresh_token.data);
      } else {
        // Assume it's already in IV+data format from database
        decryptedRefreshToken = this.decrypt((tokenRecord as any).refresh_token_iv, (tokenRecord as any).refresh_token_data);
      }
    } else if (tokenRecord.refresh_token_iv && tokenRecord.refresh_token_data) {
      // Database format: separate IV and data fields
      decryptedRefreshToken = this.decrypt(tokenRecord.refresh_token_iv, tokenRecord.refresh_token_data);
    } else {
      decryptedRefreshToken = '';
    }

    return {
      accessToken: decryptedAccessToken,
      refreshToken: decryptedRefreshToken,
      expiresAt: new Date(tokenRecord.expires_at)
    };
  }

  async refreshToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
    newTokenData: TokenData,
    tenantId?: string,
    storeId?: string
  ): Promise<void> {
    try {
      const encryptedAccessToken = this.encrypt(newTokenData.accessToken);
      const encryptedRefreshToken = newTokenData.refreshToken ? this.encrypt(newTokenData.refreshToken) : undefined;

      await dbTokenManager.updateToken(
        userId,
        provider,
        encryptedAccessToken,
        encryptedRefreshToken,
        newTokenData.expiresAt,
        tenantId,
        storeId
      );

      logger.info('Token refreshed successfully', { userId, provider });
    } catch (error) {
      logger.error('Error refreshing token', { error, userId, provider });
      throw error;
    }
  }

  async revokeToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
    storeId?: string
  ): Promise<void> {
    try {
      await dbTokenManager.deleteToken(userId, provider, storeId);
      logger.info('Token revoked successfully', { userId, provider });
    } catch (error) {
      logger.error('Error revoking token', { error, userId, provider });
      throw error;
    }
  }

  async isTokenValid(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox',
    storeId?: string
  ): Promise<boolean> {
    try {
      // Truthfully treat refreshable tokens as usable connections. The access token
      // may expire between sync attempts, but the integration is still connected if
      // we can refresh it from the stored refresh token.
      const tokenStatus = await this.getTokenWithStatus(userId, provider, storeId);
      if (tokenStatus && (!tokenStatus.isExpired || !!tokenStatus.token.refreshToken)) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking token validity', { error, userId, provider });
      return false;
    }
  }
}

export const tokenManager = new TokenManager();
export default tokenManager; 
