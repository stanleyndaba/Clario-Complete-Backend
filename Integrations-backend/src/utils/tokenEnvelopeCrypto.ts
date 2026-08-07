import crypto from 'crypto';
import logger from './logger';

export type CredentialProvider = 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox';

export type CredentialStatusCode =
  | 'valid_current_format'
  | 'valid_legacy_format'
  | 'malformed_envelope'
  | 'invalid_iv_length'
  | 'invalid_auth_tag'
  | 'decrypt_failed'
  | 'plaintext_or_unknown_format'
  | 'missing_value';

export class TokenCredentialError extends Error {
  code: CredentialStatusCode;
  reconnectRequired: boolean;

  constructor(code: CredentialStatusCode, message = 'Stored credential cannot be used') {
    super(message);
    this.name = 'TokenCredentialError';
    this.code = code;
    this.reconnectRequired = code !== 'missing_value';
  }
}

export interface EncryptedCredential {
  iv: string;
  data: string;
}

export interface CredentialInspection {
  detectedVersion: 'v2' | 'legacy_cbc_split' | 'unknown' | 'missing';
  componentCount: number;
  ivDecodedByteLength: number | null;
  authTagDecodedByteLength: number | null;
  ciphertextDecodedByteLength: number | null;
  encodedLength: number;
  result: CredentialStatusCode;
}

const CURRENT_VERSION = 2;
const CURRENT_IV_MARKER = 'v2';
const CURRENT_ALGORITHM = 'aes-256-gcm';
const LEGACY_ALGORITHM = 'aes-256-cbc';
const CURRENT_IV_LENGTH = 12;
const CURRENT_AUTH_TAG_LENGTH = 16;
const LEGACY_IV_LENGTH = 16;
const KEY_LENGTH = 32;

function decodeBase64(value: string): Buffer | null {
  try {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
}

function isCurrentEnvelope(iv: string | null | undefined, data: string | null | undefined): boolean {
  if (iv !== CURRENT_IV_MARKER || !data) return false;
  try {
    const envelope = JSON.parse(data);
    return envelope?.version === CURRENT_VERSION;
  } catch {
    return false;
  }
}

export function deriveCredentialKey(): Buffer {
  const keyMaterial = process.env.ENCRYPTION_KEY;
  if (keyMaterial && keyMaterial.length >= 64) {
    const hex = Buffer.from(keyMaterial, 'hex');
    if (hex.length === KEY_LENGTH) return hex;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY must be a 32-byte hex value in production');
  }

  const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-please-set';
  logger.warn('ENCRYPTION_KEY missing or invalid outside production; deriving credential key from JWT_SECRET');
  return crypto.pbkdf2Sync(jwtSecret, 'clario-salt', 100000, KEY_LENGTH, 'sha256');
}

export function validateCredentialKeyConfiguration(): void {
  deriveCredentialKey();
}

export class TokenEnvelopeCrypto {
  private readonly key: Buffer;

  constructor(key = deriveCredentialKey()) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
      throw new Error('Invalid credential encryption key length');
    }
    this.key = key;
  }

  encrypt(plaintext: string): EncryptedCredential {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new TokenCredentialError('missing_value', 'Credential value is missing');
    }

    const iv = crypto.randomBytes(CURRENT_IV_LENGTH);
    const cipher = crypto.createCipheriv(CURRENT_ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: CURRENT_IV_MARKER,
      data: JSON.stringify({
        version: CURRENT_VERSION,
        algorithm: CURRENT_ALGORITHM,
        encoding: 'base64',
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      }),
    };
  }

  decrypt(credential: EncryptedCredential): string {
    const inspection = this.inspect(credential);
    if (inspection.result === 'missing_value') throw new TokenCredentialError('missing_value');
    if (inspection.result !== 'valid_current_format' && inspection.result !== 'valid_legacy_format') {
      throw new TokenCredentialError(inspection.result);
    }

    if (inspection.detectedVersion === 'v2') return this.decryptCurrent(credential.data);
    return this.decryptLegacyCbc(credential.iv, credential.data);
  }

  inspect(credential?: Partial<EncryptedCredential> | null): CredentialInspection {
    const ivValue = credential?.iv || '';
    const dataValue = credential?.data || '';
    const encodedLength = String(dataValue || '').length;

    if (!ivValue || !dataValue) {
      return {
        detectedVersion: 'missing',
        componentCount: 0,
        ivDecodedByteLength: null,
        authTagDecodedByteLength: null,
        ciphertextDecodedByteLength: null,
        encodedLength,
        result: 'missing_value',
      };
    }

    if (ivValue === CURRENT_IV_MARKER) {
      try {
        const envelope = JSON.parse(dataValue);
        const iv = decodeBase64(envelope?.iv);
        const authTag = decodeBase64(envelope?.authTag);
        const ciphertext = decodeBase64(envelope?.ciphertext);
        const componentCount = ['version', 'algorithm', 'encoding', 'iv', 'authTag', 'ciphertext']
          .filter((key) => Object.prototype.hasOwnProperty.call(envelope || {}, key)).length;

        if (envelope?.version !== CURRENT_VERSION || envelope?.algorithm !== CURRENT_ALGORITHM || envelope?.encoding !== 'base64') {
          return { detectedVersion: 'v2', componentCount, ivDecodedByteLength: iv?.length ?? null, authTagDecodedByteLength: authTag?.length ?? null, ciphertextDecodedByteLength: ciphertext?.length ?? null, encodedLength, result: 'malformed_envelope' };
        }
        if (!iv || iv.length !== CURRENT_IV_LENGTH) {
          return { detectedVersion: 'v2', componentCount, ivDecodedByteLength: iv?.length ?? null, authTagDecodedByteLength: authTag?.length ?? null, ciphertextDecodedByteLength: ciphertext?.length ?? null, encodedLength, result: 'invalid_iv_length' };
        }
        if (!authTag || authTag.length !== CURRENT_AUTH_TAG_LENGTH) {
          return { detectedVersion: 'v2', componentCount, ivDecodedByteLength: iv.length, authTagDecodedByteLength: authTag?.length ?? null, ciphertextDecodedByteLength: ciphertext?.length ?? null, encodedLength, result: 'invalid_auth_tag' };
        }
        if (!ciphertext || ciphertext.length < 1) {
          return { detectedVersion: 'v2', componentCount, ivDecodedByteLength: iv.length, authTagDecodedByteLength: authTag.length, ciphertextDecodedByteLength: ciphertext?.length ?? null, encodedLength, result: 'malformed_envelope' };
        }
        return { detectedVersion: 'v2', componentCount, ivDecodedByteLength: iv.length, authTagDecodedByteLength: authTag.length, ciphertextDecodedByteLength: ciphertext.length, encodedLength, result: 'valid_current_format' };
      } catch {
        return { detectedVersion: 'v2', componentCount: 1, ivDecodedByteLength: null, authTagDecodedByteLength: null, ciphertextDecodedByteLength: null, encodedLength, result: 'malformed_envelope' };
      }
    }

    const legacyIv = decodeBase64(ivValue);
    const legacyCiphertext = decodeBase64(dataValue);
    if (legacyIv && legacyIv.length === LEGACY_IV_LENGTH && legacyCiphertext && legacyCiphertext.length > 0) {
      return {
        detectedVersion: 'legacy_cbc_split',
        componentCount: 2,
        ivDecodedByteLength: legacyIv.length,
        authTagDecodedByteLength: null,
        ciphertextDecodedByteLength: legacyCiphertext.length,
        encodedLength,
        result: 'valid_legacy_format',
      };
    }

    if (legacyIv && legacyIv.length !== LEGACY_IV_LENGTH) {
      return {
        detectedVersion: 'legacy_cbc_split',
        componentCount: 2,
        ivDecodedByteLength: legacyIv.length,
        authTagDecodedByteLength: null,
        ciphertextDecodedByteLength: legacyCiphertext?.length ?? null,
        encodedLength,
        result: 'invalid_iv_length',
      };
    }

    return {
      detectedVersion: isCurrentEnvelope(ivValue, dataValue) ? 'v2' : 'unknown',
      componentCount: 2,
      ivDecodedByteLength: legacyIv?.length ?? null,
      authTagDecodedByteLength: null,
      ciphertextDecodedByteLength: legacyCiphertext?.length ?? null,
      encodedLength,
      result: 'plaintext_or_unknown_format',
    };
  }

  private decryptCurrent(data: string): string {
    try {
      const envelope = JSON.parse(data);
      const iv = decodeBase64(envelope.iv);
      const authTag = decodeBase64(envelope.authTag);
      const ciphertext = decodeBase64(envelope.ciphertext);
      if (!iv || iv.length !== CURRENT_IV_LENGTH) throw new TokenCredentialError('invalid_iv_length');
      if (!authTag || authTag.length !== CURRENT_AUTH_TAG_LENGTH) throw new TokenCredentialError('invalid_auth_tag');
      if (!ciphertext || ciphertext.length < 1) throw new TokenCredentialError('malformed_envelope');
      const decipher = crypto.createDecipheriv(CURRENT_ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error instanceof TokenCredentialError) throw error;
      throw new TokenCredentialError('decrypt_failed');
    }
  }

  private decryptLegacyCbc(ivBase64: string, dataBase64: string): string {
    const inspection = this.inspect({ iv: ivBase64, data: dataBase64 });
    if (inspection.result !== 'valid_legacy_format') throw new TokenCredentialError(inspection.result);

    try {
      const iv = Buffer.from(ivBase64, 'base64');
      const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, this.key, iv);
      let dec = decipher.update(dataBase64, 'base64', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    } catch {
      throw new TokenCredentialError('decrypt_failed');
    }
  }
}

export const tokenEnvelopeCrypto = new TokenEnvelopeCrypto();

