import crypto from 'crypto';

export class EncryptionService {
  private static getKey(): Buffer {
    const secret = process.env.TOKEN_ENCRYPTION_KEY || '';
    if (!secret) {
      throw new Error('TOKEN_ENCRYPTION_KEY is not set');
    }
    // Derive 32-byte key using SHA-256
    return crypto.createHash('sha256').update(secret).digest();
  }

  static encrypt(plainText: string): string {
    const key = this.getKey();
    const iv = crypto.randomBytes(12); // 96-bit nonce for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Encode as base64 segments joined by ':'
    return [iv.toString('base64'), ciphertext.toString('base64'), authTag.toString('base64')].join(':');
  }

  static decrypt(encrypted: string): string {
    const [ivB64, ctB64, tagB64] = encrypted.split(':');
    if (!ivB64 || !ctB64 || !tagB64) {
      throw new Error('Invalid encrypted payload');
    }
    const key = this.getKey();
    const iv = Buffer.from(ivB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }
}

