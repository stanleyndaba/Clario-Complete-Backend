import crypto from 'crypto';
import config from '../config/env';
import logger from './logger';
import { tokenManager as dbTokenManager, TokenRecord } from '../database/supabaseClient';

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export class TokenManager {
  private encryptionKey: Buffer;

  constructor() {
    this.encryptionKey = Buffer.from(config.ENCRYPTION_KEY, 'hex');
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encryptedText: string): string {
    const textParts = encryptedText.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encrypted = textParts.join(':');
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async saveToken(
    userId: string,
    provider: 'amazon' | 'gmail' | 'stripe',
    tokenData: TokenData
  ): Promise<void> {
    try {
      const encryptedAccessToken = this.encrypt(tokenData.accessToken);
      const encryptedRefreshToken = this.encrypt(tokenData.refreshToken);

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

      const decryptedAccessToken = this.decrypt(tokenRecord.access_token);
      const decryptedRefreshToken = this.decrypt(tokenRecord.refresh_token);

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
      const encryptedRefreshToken = this.encrypt(newTokenData.refreshToken);

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
      const token = await this.getToken(userId, provider);
      return token !== null;
    } catch (error) {
      logger.error('Error checking token validity', { error, userId, provider });
      return false;
    }
  }
}

export const tokenManager = new TokenManager();
export default tokenManager; 