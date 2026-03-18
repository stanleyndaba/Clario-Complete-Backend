// @ts-nocheck
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const dbTokenManager = {
  getToken: jest.fn(),
  isTokenExpired: jest.fn(),
  saveToken: jest.fn(),
  updateToken: jest.fn(),
  deleteToken: jest.fn(),
};

jest.mock('../../src/database/supabaseClient', () => ({
  tokenManager: dbTokenManager,
}));

describe('Agent2 token truth hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AMAZON_SPAPI_REFRESH_TOKEN = 'env-refresh-token';
    process.env.AMAZON_CLIENT_ID = 'env-client-id';
    process.env.AMAZON_CLIENT_SECRET = 'env-client-secret';
  });

  it('denies token validity when DB token is missing even if env vars exist', async () => {
    dbTokenManager.getToken.mockResolvedValue(null);

    const tokenModule = await import('../../src/utils/tokenManager');
    const manager = new tokenModule.TokenManager();
    const valid = await manager.isTokenValid('user-1', 'amazon');

    expect(valid).toBe(false);
  });

  it('denies token validity when DB token is expired', async () => {
    dbTokenManager.getToken.mockResolvedValue({
      encrypted_access_token: { iv: 'iv', data: 'cipher' },
      encrypted_refresh_token: { iv: 'iv', data: 'cipher' },
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    dbTokenManager.isTokenExpired.mockResolvedValue(true);

    const tokenModule = await import('../../src/utils/tokenManager');
    jest.spyOn(tokenModule.TokenManager.prototype as any, 'decryptTokenRecord').mockReturnValue({
      accessToken: 'a',
      refreshToken: 'b',
      expiresAt: new Date(Date.now() - 60_000),
    });
    const manager = new tokenModule.TokenManager();
    const valid = await manager.isTokenValid('user-1', 'amazon');

    expect(valid).toBe(false);
  });
});
