// @ts-nocheck
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const isTokenValidMock = jest.fn();

jest.mock('../../src/utils/tokenManager', () => ({
  __esModule: true,
  default: {
    isTokenValid: isTokenValidMock,
  },
}));

jest.mock('../../src/database/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: [], error: null }),
      insert: jest.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

describe('Agent2 honest failure path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AMAZON_SPAPI_REFRESH_TOKEN = 'env-refresh-token';
    process.env.AMAZON_CLIENT_ID = 'env-client-id';
    process.env.AMAZON_CLIENT_SECRET = 'env-client-secret';
  });

  it('fails sync start when DB-backed token is invalid, even with env creds', async () => {
    isTokenValidMock.mockResolvedValue(false);
    const { syncJobManager } = await import('../../src/services/syncJobManager');

    await expect(syncJobManager.startSync('user-1')).rejects.toThrow('Amazon connection not found');
  });
});
