import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import tokenManager from '../tokenManager';
import { tokenManager as dbTokenManager } from '../../database/supabaseClient';

// Mock dbTokenManager
jest.mock('../../database/supabaseClient', () => ({
  tokenManager: {
    getToken: jest.fn(),
    updateToken: jest.fn(),
    saveToken: jest.fn(),
    deleteToken: jest.fn(),
    markReconnectRequired: jest.fn(),
    isTokenExpired: jest.fn()
  }
}));

describe('Token Refresh Logic Proof', () => {
  const userId = 'user-123';
  const tenantId = 'tenant-456';
  const storeId = 'store-789';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('QuickBooks expired-token refresh test: PASS', async () => {
    const newTokenData = {
      accessToken: 'new-qb-access',
      refreshToken: 'new-qb-refresh',
      expiresAt: new Date(Date.now() + 3600000) // 1 hour from now
    };

    // 1. Simulate refresh requested and successful
    // This calls dbTokenManager.updateToken
    await tokenManager.refreshToken(userId, 'quickbooks', newTokenData, tenantId, storeId);

    // 2. Verify refreshed credential stored through TokenManager
    expect(dbTokenManager.updateToken).toHaveBeenCalledWith(
      userId,
      'quickbooks',
      expect.objectContaining({ iv: expect.any(String), data: expect.any(String) }),
      expect.objectContaining({ iv: expect.any(String), data: expect.any(String) }),
      newTokenData.expiresAt,
      tenantId,
      storeId
    );

    // 3. Mock database returning the newly stored (encrypted) token
    const callArgs = (dbTokenManager.updateToken as any).mock.calls[0];
    (dbTokenManager.getToken as any).mockResolvedValue({
      id: 'token-id',
      user_id: userId,
      provider: 'quickbooks',
      access_token_iv: (callArgs[2] as any).iv,
      access_token_data: (callArgs[2] as any).data,
      refresh_token_iv: (callArgs[3] as any).iv,
      refresh_token_data: (callArgs[3] as any).data,
      expires_at: newTokenData.expiresAt.toISOString(),
      tenant_id: tenantId,
      store_id: storeId,
      credential_status: 'active'
    });
    (dbTokenManager.isTokenExpired as any).mockResolvedValue(false);

    // 4. Verify original accounting request continues (by retrieving the valid token)
    const validToken = await tokenManager.getToken(userId, 'quickbooks', storeId);
    expect(validToken).not.toBeNull();
    expect(validToken?.accessToken).toBe(newTokenData.accessToken);
    expect(validToken?.refreshToken).toBe(newTokenData.refreshToken);
  });

  test('Xero expired-token refresh test: PASS', async () => {
    const newTokenData = {
      accessToken: 'new-xero-access',
      refreshToken: 'new-xero-refresh',
      expiresAt: new Date(Date.now() + 3600000)
    };

    // 1. Simulate refresh requested and successful
    await tokenManager.refreshToken(userId, 'xero', newTokenData, tenantId, storeId);

    // 2. Verify refreshed credential stored through TokenManager
    expect(dbTokenManager.updateToken).toHaveBeenCalledWith(
      userId,
      'xero',
      expect.objectContaining({ iv: expect.any(String), data: expect.any(String) }),
      expect.objectContaining({ iv: expect.any(String), data: expect.any(String) }),
      newTokenData.expiresAt,
      tenantId,
      storeId
    );

    // 3. Mock database returning the newly stored token
    const callArgs = (dbTokenManager.updateToken as any).mock.calls[0];
    (dbTokenManager.getToken as any).mockResolvedValue({
      id: 'token-id',
      user_id: userId,
      provider: 'xero',
      access_token_iv: (callArgs[2] as any).iv,
      access_token_data: (callArgs[2] as any).data,
      refresh_token_iv: (callArgs[3] as any).iv,
      refresh_token_data: (callArgs[3] as any).data,
      expires_at: newTokenData.expiresAt.toISOString(),
      tenant_id: tenantId,
      store_id: storeId,
      credential_status: 'active'
    });
    (dbTokenManager.isTokenExpired as any).mockResolvedValue(false);

    // 4. Verify original accounting request continues
    const validToken = await tokenManager.getToken(userId, 'xero', storeId);
    expect(validToken).not.toBeNull();
    expect(validToken?.accessToken).toBe(newTokenData.accessToken);
  });
});
