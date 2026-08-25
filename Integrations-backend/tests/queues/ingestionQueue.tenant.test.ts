// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const addMock = jest.fn();
const pingMock = jest.fn().mockResolvedValue('PONG');
let queueModule: typeof import('../../src/queues/ingestionQueue') | null = null;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: addMock,
    client: Promise.resolve({ ping: pingMock }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  QueueEvents: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('Agent2 queue tenant scoping', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    addMock.mockResolvedValue({ id: 'job-1' });
  });

  afterEach(async () => {
    await queueModule?.closeQueue();
    queueModule = null;
  });

  it('adds tenant_id into payload and tenant-safe dedupe key', async () => {
    queueModule = await import('../../src/queues/ingestionQueue');

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
