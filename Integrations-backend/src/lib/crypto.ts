import crypto from 'crypto';

// AES-256-GCM helpers for encrypting sensitive tokens at rest
const ALGORITHM = 'aes-256-gcm';
const KEY_HEX = process.env.TOKEN_ENCRYPTION_KEY || '';

if (!KEY_HEX || Buffer.from(KEY_HEX, 'base64').length !== 32) {
  // Expect base64-encoded 32-byte key (openssl rand -base64 32)
  throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
}

const KEY = Buffer.from(KEY_HEX, 'base64');

export function encrypt(raw: string): string {
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Output: base64(iv|tag|ciphertext)
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28); // 16 bytes tag
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return plaintext;
}






