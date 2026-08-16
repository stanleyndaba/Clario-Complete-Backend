import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import oauthStateStore from '../../src/utils/oauthStateStore';
import { getRedisClient, isRedisAvailable } from '../../src/utils/redisClient';

jest.mock('../../src/utils/redisClient', () => ({
  getRedisClient: jest.fn(),
  isRedisAvailable: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('oauthStateStore audit context', () => {
  const redis: any = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (isRedisAvailable as any).mockReturnValue(true);
    (getRedisClient as any).mockResolvedValue(redis);
    redis.set.mockResolvedValue('OK');
    redis.get.mockResolvedValue(null);
    redis.del.mockResolvedValue(1);
  });

  it('persists OAuth context needed to resume the exact audit route', async () => {
    await oauthStateStore.setState(
      'state-audit-1',
      'user-1',
      'https://margin-finance.com',
      'tenant-one',
      'ATVPDKIKX0DER',
      undefined,
      undefined,
      false,
      'intent-1',
      'audit-1'
    );

    const stored = await oauthStateStore.get('state-audit-1');

    expect(stored).toMatchObject({
      userId: 'user-1',
      tenantSlug: 'tenant-one',
      marketplaceId: 'ATVPDKIKX0DER',
      frontendUrl: 'https://margin-finance.com',
      auditIntentId: 'intent-1',
      auditRunId: 'audit-1',
    });
  });

  it('supports one-time OAuth state consumption by deleting callback state', async () => {
    await oauthStateStore.setState(
      'state-replay-1',
      'user-1',
      'https://margin-finance.com',
      'tenant-one',
      'ATVPDKIKX0DER',
      undefined,
      undefined,
      false,
      'intent-1',
      'audit-1'
    );

    expect(await oauthStateStore.get('state-replay-1')).not.toBeNull();
    await oauthStateStore.delete('state-replay-1');

    const replayed = await oauthStateStore.get('state-replay-1');

    expect(replayed).toBeNull();
  });

  it('rejects stale OAuth state recovered from Redis and removes it', async () => {
    const oldTimestamp = Date.now() - (11 * 60 * 1000);
    redis.get.mockResolvedValueOnce(JSON.stringify({
      frontendUrl: 'https://margin-finance.com',
      userId: 'user-1',
      tenantSlug: 'tenant-one',
      auditIntentId: 'intent-expired',
      auditRunId: 'audit-expired',
      timestamp: oldTimestamp,
    }));

    const stale = await oauthStateStore.get('state-expired-1');

    expect(stale).toBeNull();
    expect(redis.del).toHaveBeenCalledWith('oauth_state:state-expired-1');
  });
});
