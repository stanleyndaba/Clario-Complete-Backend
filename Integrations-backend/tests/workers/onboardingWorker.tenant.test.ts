// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const syncUserDataMock = jest.fn().mockResolvedValue({ syncId: 'sync-1', success: true });
let capturedProcessor: ((job: any) => Promise<void>) | null = null;
let workerModule: typeof import('../../src/workers/onboardingWorker') | null = null;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: (job: any) => Promise<void>) => {
    capturedProcessor = processor;
    return {
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }),
}));

jest.mock('../../src/services/agent2DataSyncService', () => ({
  __esModule: true,
  default: {
    syncUserData: syncUserDataMock,
  },
}));

jest.mock('../../src/services/cacheService', () => ({
  __esModule: true,
  default: {
    invalidateUserCaches: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Agent2 onboarding worker tenant context', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    capturedProcessor = null;
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  afterEach(async () => {
    await workerModule?.stopOnboardingWorker();
    workerModule = null;
  });

  it('invokes sync service with tenant context from job payload', async () => {
    workerModule = await import('../../src/workers/onboardingWorker');
    workerModule.startOnboardingWorker();

    expect(capturedProcessor).not.toBeNull();
    await capturedProcessor!({
      id: 'job-1',
      data: {
        userId: 'user-1',
        tenantId: 'tenant-a',
        sellerId: 'seller-1',
        storeId: 'store-1',
        jobType: 'initial-sync',
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
      updateProgress: jest.fn(),
    });

    expect(syncUserDataMock).toHaveBeenCalledWith(
      'user-1',
      'store-1',
      undefined,
      undefined,
      undefined,
      'tenant-a'
    );
  });
});
