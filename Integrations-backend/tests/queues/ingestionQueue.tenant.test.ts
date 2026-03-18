// @ts-nocheck
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const addMock = jest.fn();
const pingMock = jest.fn().mockResolvedValue('PONG');

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: addMock,
    client: Promise.resolve({ ping: pingMock }),
  })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
}));

describe('Agent2 queue tenant scoping', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    addMock.mockResolvedValue({ id: 'job-1' });
  });

  it('adds tenant_id into payload and tenant-safe dedupe key', async () => {
    const queueModule = await import('../../src/queues/ingestionQueue');

    const jobId = await queueModule.addSyncJob('user-1', 'seller-1', {
      tenantId: 'tenant-a',
      storeId: 'store-1',
      companyName: 'Tenant A Co',
      marketplaces: ['ATVPDKIKX0DER'],
    });

    expect(jobId).toBe('job-1');
    expect(addMock).toHaveBeenCalledTimes(1);
    const [, payload, options] = addMock.mock.calls[0];
    expect(payload.tenantId).toBe('tenant-a');
    expect(options.jobId).toContain('tenant-a');
  });
});
