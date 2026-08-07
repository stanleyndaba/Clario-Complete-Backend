import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetToken = jest.fn();
const mockMarkReconnectRequired = jest.fn();

jest.mock('../../src/database/supabaseClient', () => ({
  tokenManager: {
    getToken: mockGetToken,
    markReconnectRequired: mockMarkReconnectRequired,
    isTokenExpired: jest.fn()
  }
}));

jest.mock('../../src/config/env', () => ({
  __esModule: true,
  default: {
    JWT_SECRET: 'test-internal-secret'
  }
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

describe('tokenManager credential health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('marks malformed stored credentials reconnect-required instead of throwing invalid IV errors', async () => {
    jest.resetModules();
    const { default: tokenManager } = await import('../../src/utils/tokenManager');

    mockGetToken.mockResolvedValue({
      id: 'token-row-1',
      user_id: 'user-1',
      provider: 'amazon',
      access_token_iv: 'bad',
      access_token_data: 'bad',
      refresh_token_iv: 'bad',
      refresh_token_data: 'bad',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      credential_status: 'active',
      credential_error_code: null
    } as never);

    const tokenStatus = await tokenManager.getTokenWithStatus('user-1', 'amazon');

    expect(tokenStatus).toBeNull();
    expect(mockMarkReconnectRequired).toHaveBeenCalledWith('token-row-1', 'amazon', 'invalid_iv_length');
  });

  it('does not attempt decryption for credentials already marked reconnect-required', async () => {
    jest.resetModules();
    const { default: tokenManager } = await import('../../src/utils/tokenManager');

    mockGetToken.mockResolvedValue({
      id: 'token-row-2',
      user_id: 'user-1',
      provider: 'amazon',
      access_token_iv: 'bad',
      access_token_data: 'bad',
      refresh_token_iv: 'bad',
      refresh_token_data: 'bad',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      credential_status: 'reconnect_required',
      credential_error_code: 'invalid_iv_length'
    } as never);

    const tokenStatus = await tokenManager.getTokenWithStatus('user-1', 'amazon');

    expect(tokenStatus).toBeNull();
    expect(mockMarkReconnectRequired).not.toHaveBeenCalled();
  });
});
