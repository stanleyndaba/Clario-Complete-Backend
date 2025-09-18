import { TokenCrypto, createTokenCrypto, encryptToken, decryptToken } from '../../src/utils/tokenCrypto';

// Mock crypto module
jest.mock('crypto', () => ({
  randomBytes: jest.fn(),
  scryptSync: jest.fn(),
  createCipher: jest.fn(),
  createDecipher: jest.fn()
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('TokenCrypto', () => {
  let tokenCrypto: TokenCrypto;
  let mockCipher: any;
  let mockDecipher: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up environment variable
    process.env['TOKEN_ENCRYPTION_KEY'] = 'test-encryption-key-32-chars-long-enough';
    
    // Mock crypto functions
    const crypto = require('crypto');
    crypto.scryptSync.mockReturnValue(Buffer.from('derived-key-32-bytes-long'));
    crypto.randomBytes.mockReturnValue(Buffer.from('random-iv-16-bytes'));
    
    // Mock cipher
    mockCipher = {
      setAAD: jest.fn(),
      update: jest.fn().mockReturnValue('encrypted-hex'),
      final: jest.fn().mockReturnValue('final-hex'),
      getAuthTag: jest.fn().mockReturnValue(Buffer.from('auth-tag-16-bytes'))
    };
    
    // Mock decipher
    mockDecipher = {
      setAAD: jest.fn(),
      setAuthTag: jest.fn(),
      update: jest.fn().mockReturnValue('decrypted-text'),
      final: jest.fn().mockReturnValue('final-text')
    };
    
    crypto.createCipher.mockReturnValue(mockCipher);
    crypto.createDecipher.mockReturnValue(mockDecipher);
    
    tokenCrypto = new TokenCrypto();
  });

  afterEach(() => {
    delete process.env['TOKEN_ENCRYPTION_KEY'];
  });

  describe('constructor', () => {
    it('should throw error when TOKEN_ENCRYPTION_KEY is missing', () => {
      delete process.env['TOKEN_ENCRYPTION_KEY'];
      
      expect(() => new TokenCrypto()).toThrow(
        'TOKEN_ENCRYPTION_KEY environment variable must be at least 32 characters'
      );
    });

    it('should throw error when TOKEN_ENCRYPTION_KEY is too short', () => {
      process.env['TOKEN_ENCRYPTION_KEY'] = 'short';
      
      expect(() => new TokenCrypto()).toThrow(
        'TOKEN_ENCRYPTION_KEY environment variable must be at least 32 characters'
      );
    });

    it('should initialize successfully with valid key', () => {
      expect(tokenCrypto).toBeInstanceOf(TokenCrypto);
    });
  });

  describe('encryptToken', () => {
    it('should encrypt a token successfully', () => {
      const rawToken = 'test-access-token-123';
      
      const result = tokenCrypto.encryptToken(rawToken);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(mockCipher.setAAD).toHaveBeenCalledWith(Buffer.from('token-encryption', 'utf8'));
      expect(mockCipher.update).toHaveBeenCalledWith(rawToken, 'utf8', 'hex');
      expect(mockCipher.final).toHaveBeenCalledWith('hex');
      expect(mockCipher.getAuthTag).toHaveBeenCalled();
    });

    it('should throw error for invalid input', () => {
      const invalidInputs = ['', null, undefined, 123, {}];
      
      for (const input of invalidInputs) {
        expect(() => tokenCrypto.encryptToken(input as any)).toThrow('Invalid token input');
      }
    });

    it('should handle encryption errors gracefully', () => {
      const rawToken = 'test-token';
      mockCipher.update.mockImplementation(() => {
        throw new Error('Encryption failed');
      });
      
      expect(() => tokenCrypto.encryptToken(rawToken)).toThrow('Token encryption failed');
    });

    it('should generate different ciphertexts for same input', () => {
      const rawToken = 'test-token';
      
      const result1 = tokenCrypto.encryptToken(rawToken);
      const result2 = tokenCrypto.encryptToken(rawToken);
      
      expect(result1).not.toBe(result2); // Different IVs should produce different ciphertexts
    });
  });

  describe('decryptToken', () => {
    it('should decrypt a token successfully', () => {
      const rawToken = 'test-access-token-123';
      const encrypted = tokenCrypto.encryptToken(rawToken);
      
      const result = tokenCrypto.decryptToken(encrypted);
      
      expect(result).toBe(rawToken);
      expect(mockDecipher.setAAD).toHaveBeenCalledWith(Buffer.from('token-encryption', 'utf8'));
      expect(mockDecipher.setAuthTag).toHaveBeenCalled();
    });

    it('should throw error for invalid input', () => {
      const invalidInputs = ['', null, undefined, 123, {}];
      
      for (const input of invalidInputs) {
        expect(() => tokenCrypto.decryptToken(input as any)).toThrow('Invalid ciphertext input');
      }
    });

    it('should throw error for tampered ciphertext', () => {
      const rawToken = 'test-token';
      const encrypted = tokenCrypto.encryptToken(rawToken);
      
      // Tamper with the ciphertext
      const tampered = encrypted.slice(0, -1) + 'X';
      
      expect(() => tokenCrypto.decryptToken(tampered)).toThrow('Token decryption failed');
    });

    it('should throw error for malformed base64', () => {
      expect(() => tokenCrypto.decryptToken('invalid-base64!@#')).toThrow('Token decryption failed');
    });

    it('should throw error for too short ciphertext', () => {
      const shortCiphertext = Buffer.from('short').toString('base64');
      
      expect(() => tokenCrypto.decryptToken(shortCiphertext)).toThrow('Token decryption failed');
    });

    it('should handle decryption errors gracefully', () => {
      const rawToken = 'test-token';
      const encrypted = tokenCrypto.encryptToken(rawToken);
      
      mockDecipher.update.mockImplementation(() => {
        throw new Error('Decryption failed');
      });
      
      expect(() => tokenCrypto.decryptToken(encrypted)).toThrow('Token decryption failed');
    });
  });

  describe('encrypt/decrypt roundtrip', () => {
    it('should successfully encrypt and decrypt various tokens', () => {
      const testTokens = [
        'simple-token',
        'token-with-special-chars!@#$%^&*()',
        'token-with-spaces and newlines\n',
        'very-long-token-'.repeat(100),
        'unicode-token-🚀-🎉-🔥',
        'token-with-quotes-"single"-and-\'double\'',
        'token-with-json-{"key":"value","number":123}'
      ];
      
      for (const token of testTokens) {
        const encrypted = tokenCrypto.encryptToken(token);
        const decrypted = tokenCrypto.decryptToken(encrypted);
        
        expect(decrypted).toBe(token);
      }
    });

    it('should handle empty string token', () => {
      const emptyToken = '';
      const encrypted = tokenCrypto.encryptToken(emptyToken);
      const decrypted = tokenCrypto.decryptToken(encrypted);
      
      expect(decrypted).toBe(emptyToken);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted tokens', () => {
      const rawToken = 'test-token';
      const encrypted = tokenCrypto.encryptToken(rawToken);
      
      expect(tokenCrypto.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for non-encrypted strings', () => {
      const nonEncrypted = ['plain-text', '', 'not-base64', '12345'];
      
      for (const text of nonEncrypted) {
        expect(tokenCrypto.isEncrypted(text)).toBe(false);
      }
    });

    it('should return false for invalid inputs', () => {
      const invalidInputs = [null, undefined, 123, {}, []];
      
      for (const input of invalidInputs) {
        expect(tokenCrypto.isEncrypted(input as any)).toBe(false);
      }
    });

    it('should return false for tampered ciphertext', () => {
      const rawToken = 'test-token';
      const encrypted = tokenCrypto.encryptToken(rawToken);
      const tampered = encrypted.slice(0, -1) + 'X';
      
      expect(tokenCrypto.isEncrypted(tampered)).toBe(false);
    });
  });

  describe('generateKey', () => {
    it('should generate a valid encryption key', () => {
      const key = TokenCrypto.generateKey();
      
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      
      // Should be valid base64
      expect(() => Buffer.from(key, 'base64')).not.toThrow();
    });

    it('should generate different keys on each call', () => {
      const key1 = TokenCrypto.generateKey();
      const key2 = TokenCrypto.generateKey();
      
      expect(key1).not.toBe(key2);
    });
  });

  describe('createTokenCrypto', () => {
    it('should create TokenCrypto instance', () => {
      const crypto = createTokenCrypto();
      expect(crypto).toBeInstanceOf(TokenCrypto);
    });
  });

  describe('convenience functions', () => {
    it('should encrypt token using convenience function', () => {
      const rawToken = 'test-token';
      const encrypted = encryptToken(rawToken);
      
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
    });

    it('should decrypt token using convenience function', () => {
      const rawToken = 'test-token';
      const encrypted = encryptToken(rawToken);
      const decrypted = decryptToken(encrypted);
      
      expect(decrypted).toBe(rawToken);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long tokens', () => {
      const longToken = 'a'.repeat(10000);
      const encrypted = tokenCrypto.encryptToken(longToken);
      const decrypted = tokenCrypto.decryptToken(encrypted);
      
      expect(decrypted).toBe(longToken);
    });

    it('should handle tokens with null bytes', () => {
      const tokenWithNulls = 'token\0with\0nulls';
      const encrypted = tokenCrypto.encryptToken(tokenWithNulls);
      const decrypted = tokenCrypto.decryptToken(encrypted);
      
      expect(decrypted).toBe(tokenWithNulls);
    });

    it('should handle tokens with unicode surrogate pairs', () => {
      const unicodeToken = 'token-🚀-🎉-🔥-🌟';
      const encrypted = tokenCrypto.encryptToken(unicodeToken);
      const decrypted = tokenCrypto.decryptToken(encrypted);
      
      expect(decrypted).toBe(unicodeToken);
    });

    it('should fail gracefully when crypto operations throw', () => {
      const crypto = require('crypto');
      crypto.createCipher.mockImplementation(() => {
        throw new Error('Crypto error');
      });
      
      expect(() => tokenCrypto.encryptToken('test')).toThrow('Token encryption failed');
    });

    it('should handle base64 decoding errors', () => {
      expect(() => tokenCrypto.decryptToken('not-base64!@#')).toThrow('Token decryption failed');
    });
  });
});
