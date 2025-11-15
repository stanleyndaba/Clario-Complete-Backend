import crypto from 'crypto';
import config from '../config/env';
import logger from './logger';
import { tokenManager as dbTokenManager, TokenRecord } from '../database/supabaseClient';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
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
    provider: 'amazon' | 'gmail' | 'stripe',
    tokenData: TokenData
  ): Promise<void> {
    try {
      const encryptedAccessToken = this.encrypt(tokenData.accessToken);
      const encryptedRefreshToken = tokenData.refreshToken ? this.encrypt(tokenData.refreshToken) : undefined;

      await dbTokenManager.saveToken(
        userId,
        provider,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenData.expiresAt
      );

      logger.info('Token saved successfully', { userId, provider });
    } catch (error) {
      logger.error('Error saving token', { error, userId, provider });
      throw error;
    }
  }

  async getToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe'
  ): Promise<TokenData | null> {
    try {
      const tokenRecord = await dbTokenManager.getToken(userId, provider);
      
      if (!tokenRecord) {
        return null;
      }

      // Check if token is expired
      if (await dbTokenManager.isTokenExpired(tokenRecord)) {
        logger.info('Token is expired', { userId, provider });
        return null;
      }

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
      } else {
        decryptedRefreshToken = '';
      }

      return {
        accessToken: decryptedAccessToken,
        refreshToken: decryptedRefreshToken,
        expiresAt: new Date(tokenRecord.expires_at)
      };
    } catch (error) {
      logger.error('Error getting token', { error, userId, provider });
      throw error;
    }
  }

  async refreshToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe',
    newTokenData: TokenData
  ): Promise<void> {
    try {
      const encryptedAccessToken = this.encrypt(newTokenData.accessToken);
      const encryptedRefreshToken = newTokenData.refreshToken ? this.encrypt(newTokenData.refreshToken) : undefined;

      await dbTokenManager.updateToken(
        userId,
        provider,
        encryptedAccessToken,
        encryptedRefreshToken,
        newTokenData.expiresAt
      );

      logger.info('Token refreshed successfully', { userId, provider });
    } catch (error) {
      logger.error('Error refreshing token', { error, userId, provider });
      throw error;
    }
  }

  async revokeToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe'
  ): Promise<void> {
    try {
      await dbTokenManager.deleteToken(userId, provider);
      logger.info('Token revoked successfully', { userId, provider });
    } catch (error) {
      logger.error('Error revoking token', { error, userId, provider });
      throw error;
    }
  }

  async isTokenValid(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe'
  ): Promise<boolean> {
    try {
      // First check database
      const token = await this.getToken(userId, provider);
      if (token !== null) {
        return true;
      }
      
      // If no database token, check environment variables (for sandbox/demo mode)
      if (provider === 'amazon') {
        const envRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
        const envClientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
        const envClientSecret = process.env.AMAZON_CLIENT_SECRET;
        
        if (envRefreshToken && envClientId && envClientSecret) {
          logger.info('Token valid from environment variables (sandbox mode)', { userId, provider });
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Error checking token validity', { error, userId, provider });
      
      // On error, still check environment variables as fallback
      if (provider === 'amazon') {
        const envRefreshToken = process.env.AMAZON_SPAPI_REFRESH_TOKEN;
        if (envRefreshToken) {
          logger.info('Token available from environment variables despite error', { userId, provider });
          return true;
        }
      }
      
      return false;
    }
  }
}

export const tokenManager = new TokenManager();
export default tokenManager; 