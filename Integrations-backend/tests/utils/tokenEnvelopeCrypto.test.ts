import crypto from 'crypto';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { TokenCredentialError, TokenEnvelopeCrypto } from '../../src/utils/tokenEnvelopeCrypto';

describe('TokenEnvelopeCrypto', () => {
  const key = Buffer.from('0123456789abcdef0123456789abcdef');
  let tokenCrypto: TokenEnvelopeCrypto;

  beforeEach(() => {
    tokenCrypto = new TokenEnvelopeCrypto(key);
  });

  it('encrypts and decrypts the current canonical envelope', () => {
    const encrypted = tokenCrypto.encrypt('refresh-token-secret');
    expect(encrypted.iv).toBe('v2');
    expect(encrypted.data).not.toContain('refresh-token-secret');
    expect(tokenCrypto.decrypt(encrypted)).toBe('refresh-token-secret');
    expect(tokenCrypto.inspect(encrypted).result).toBe('valid_current_format');
  });

  it('validates IV length before decryption', () => {
    const encrypted = tokenCrypto.encrypt('secret');
    const envelope = JSON.parse(encrypted.data);
    envelope.iv = Buffer.from('short').toString('base64');
    const malformed = { iv: 'v2', data: JSON.stringify(envelope) };

    const inspection = tokenCrypto.inspect(malformed);
    expect(inspection.result).toBe('invalid_iv_length');
    expect(() => tokenCrypto.decrypt(malformed)).toThrow(TokenCredentialError);
  });

  it('validates auth tag length before decryption', () => {
    const encrypted = tokenCrypto.encrypt('secret');
    const envelope = JSON.parse(encrypted.data);
    envelope.authTag = Buffer.from('short').toString('base64');
    const malformed = { iv: 'v2', data: JSON.stringify(envelope) };

    const inspection = tokenCrypto.inspect(malformed);
    expect(inspection.result).toBe('invalid_auth_tag');
    expect(() => tokenCrypto.decrypt(malformed)).toThrow(TokenCredentialError);
  });

  it('rejects malformed envelopes safely', () => {
    const malformed = { iv: 'v2', data: '{not-json' };
    expect(tokenCrypto.inspect(malformed).result).toBe('malformed_envelope');
    expect(() => tokenCrypto.decrypt(malformed)).toThrow(TokenCredentialError);
  });

  it('decrypts known legacy AES-CBC split format', () => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let data = cipher.update('legacy-refresh-token', 'utf8', 'base64');
    data += cipher.final('base64');

    const legacy = { iv: iv.toString('base64'), data };
    expect(tokenCrypto.inspect(legacy).result).toBe('valid_legacy_format');
    expect(tokenCrypto.decrypt(legacy)).toBe('legacy-refresh-token');
  });

  it('does not guess unknown plaintext-like formats', () => {
    const unknown = { iv: 'not-an-iv', data: 'plain-token-looking-value' };
    expect(tokenCrypto.inspect(unknown).result).toBe('invalid_iv_length');
    expect(() => tokenCrypto.decrypt(unknown)).toThrow(TokenCredentialError);
  });
});
