import crypto from 'crypto';
import logger from './logger';

/**
 * Token encryption wrapper using AES-256-GCM
 * Provides secure encryption/decryption for sensitive tokens
 */
export class TokenCrypto {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly authTagLength = 16; // 128 bits
  private readonly secretKey: Buffer;

  constructor() {
    const secretKey = process.env['TOKEN_ENCRYPTION_KEY'];
    if (!secretKey || secretKey.length < 32) {
      throw new Error('TOKEN_ENCRYPTION_KEY environment variable must be at least 32 characters');
    }
    
    // Derive a consistent key from the secret
    this.secretKey = crypto.scryptSync(secretKey, 'salt', this.keyLength);
  }

  /**
   * Encrypt a raw token using AES-256-GCM
   * Returns base64-encoded string containing IV + ciphertext + auth tag
   */
  encryptToken(rawToken: string): string {
    try {
      if (!rawToken || typeof rawToken !== 'string') {
        throw new Error('Invalid token input');
      }

      // Generate random IV
      const iv = crypto.randomBytes(this.ivLength);
      
      // Create cipher
      const cipher = crypto.createCipher(this.algorithm, this.secretKey);
      cipher.setAAD(Buffer.from('token-encryption', 'utf8'));
      
      // Encrypt the token
      let encrypted = cipher.update(rawToken, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get authentication tag
      const authTag = cipher.getAuthTag();
      
      // Combine IV + ciphertext + auth tag
      const combined = Buffer.concat([iv, Buffer.from(encrypted, 'hex'), authTag]);
      
      // Return base64 encoded
      const result = combined.toString('base64');
      
      logger.info('Token encrypted successfully', {
        tokenLength: rawToken.length,
        encryptedLength: result.length
      });
      
      return result;
    } catch (error) {
      logger.error('Token encryption failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Token encryption failed');
    }
  }

  /**
   * Decrypt a token using AES-256-GCM
   * Expects base64-encoded string containing IV + ciphertext + auth tag
   */
  decryptToken(cipherText: string): string {
    try {
      if (!cipherText || typeof cipherText !== 'string') {
        throw new Error('Invalid ciphertext input');
      }

      // Decode from base64
      const combined = Buffer.from(cipherText, 'base64');
      
      // Extract components
      // const iv = combined.subarray(0, this.ivLength);
      const authTag = combined.subarray(combined.length - this.authTagLength);
      const encrypted = combined.subarray(this.ivLength, combined.length - this.authTagLength);
      
      // Create decipher
      const decipher = crypto.createDecipher(this.algorithm, this.secretKey);
      decipher.setAAD(Buffer.from('token-encryption', 'utf8'));
      decipher.setAuthTag(authTag);
      
      // Decrypt
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      
      logger.info('Token decrypted successfully', {
        cipherTextLength: cipherText.length,
        decryptedLength: decrypted.length
      });
      
      return decrypted;
    } catch (error) {
      logger.error('Token decryption failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        cipherTextLength: cipherText?.length || 0
      });
      throw new Error('Token decryption failed');
    }
  }

  /**
   * Test if a string is encrypted (basic validation)
   */
  isEncrypted(value: string): boolean {
    try {
      if (!value || typeof value !== 'string') {
        return false;
      }
      
      // Try to decode as base64
      const decoded = Buffer.from(value, 'base64');
      
      // Check minimum length (IV + minimal ciphertext + auth tag)
      if (decoded.length < this.ivLength + 1 + this.authTagLength) {
        return false;
      }
      
      // Try to decrypt (this will fail if not properly encrypted)
      this.decryptToken(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a new encryption key (for development/testing)
   */
  static generateKey(): string {
    return crypto.randomBytes(32).toString('base64');
  }
}

/**
 * Factory function to create TokenCrypto instance
 */
export function createTokenCrypto(): TokenCrypto {
  return new TokenCrypto();
}

// Export convenience functions
export const encryptToken = (rawToken: string): string => {
  const crypto = createTokenCrypto();
  return crypto.encryptToken(rawToken);
};

export const decryptToken = (cipherText: string): string => {
  const crypto = createTokenCrypto();
  return crypto.decryptToken(cipherText);
};
