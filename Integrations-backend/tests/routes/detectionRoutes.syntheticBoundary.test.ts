import express from 'express';
import request from 'supertest';
import { describe, expect, it, jest } from '@jest/globals';

const triggerDetectionPipeline = jest.fn();
const mockGetDetectionResultsTotal: any = jest.fn();
const mockGetDetectionResults: any = jest.fn();
const mockGetCsvUploadRunBySyncId: any = jest.fn();
mockGetDetectionResultsTotal.mockResolvedValue(0);
mockGetDetectionResults.mockResolvedValue([]);
mockGetCsvUploadRunBySyncId.mockResolvedValue(null);
const queueFilters: Array<{ field: string; value: any }> = [];
let mockQueueRows: any[] = [];

jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: jest.fn(async (_req: any, _res: any, next: any) => next()),
}));

jest.mock('../../src/middleware/userIdMiddleware', () => ({
  userIdMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'training-user' };
    req.userId = 'training-user';
    req.tenant = { tenantId: '22222222-2222-4222-8222-222222222222' };
    next();
  },
}));

jest.mock('../../src/services/enhancedDetectionService', () => ({
  __esModule: true,
  default: { triggerDetectionPipeline },
}));

jest.mock('../../src/services/detectionService', () => ({
  __esModule: true,
  default: { getDetectionResultsTotal: mockGetDetectionResultsTotal, getDetectionResults: mockGetDetectionResults },
}));

jest.mock('../../src/services/csvIngestionService', () => ({
  __esModule: true,
  default: { getCsvUploadRunBySyncId: mockGetCsvUploadRunBySyncId },
}));

jest.mock('../../src/database/supabaseClient', () => {
  const query: any = {
    select: () => query,
    eq: (field: string, value: any) => {
      queueFilters.push({ field, value });
      return query;
    },
    order: () => query,
    limit: async () => ({ data: mockQueueRows, error: null }),
  };
  return { supabaseAdmin: { from: () => query } };
});

jest.mock('../../src/services/timelineService', () => ({
  timelineService: {},
}));

jest.mock('../../src/services/detectionFindingTruthService', () => ({
  enrichDetectionFinding: jest.fn(),
}));

jest.mock('../../src/services/detection/detectorCoverageMapService', () => ({
  getDetectorCoverageMap: jest.fn(() => []),
}));

import detectionRoutes from '../../src/routes/detectionRoutes';

describe('direct detection synthetic execution boundary', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/integrations/detections', detectionRoutes);

  it('scopes status queue lookup to the authenticated tenant', async () => {
    queueFilters.length = 0;
    mockQueueRows = [];

    const response = await request(app)
      .get('/api/v1/integrations/detections/status/csv_123')
      .set('x-tenant-id', '22222222-2222-4222-8222-222222222222');

    expect(response.status).toBe(200);
    expect(queueFilters).toEqual(expect.arrayContaining([
      { field: 'tenant_id', value: '22222222-2222-4222-8222-222222222222' },
      { field: 'seller_id', value: 'training-user' },
      { field: 'sync_id', value: 'csv_123' },
    ]));
  });

  it('fails closed when a synthetic status request has no authoritative queue provenance', async () => {
    const previousTrainingTenant = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = '22222222-2222-4222-8222-222222222222';
    mockQueueRows = [];

    try {
      const response = await request(app)
        .get('/api/v1/integrations/detections/status/synthetic_csv_123')
        .set('x-tenant-id', '22222222-2222-4222-8222-222222222222');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SYNTHETIC_PROVENANCE_REQUIRED');
    } finally {
      if (previousTrainingTenant === undefined) delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
      else process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = previousTrainingTenant;
    }
  });

  it('labels a synthetic status only after queue provenance and tenant configuration both verify', async () => {
    const previousTrainingTenant = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = '22222222-2222-4222-8222-222222222222';
    mockQueueRows = [{
      id: 'queue-1',
      sync_id: 'synthetic_csv_123',
      status: 'completed',
      payload: { execution_provenance: 'SYNTHETIC_TRAINING_ONLY' },
    }];

    try {
      const response = await request(app)
        .get('/api/v1/integrations/detections/status/synthetic_csv_123')
        .set('x-tenant-id', '22222222-2222-4222-8222-222222222222');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({
        synthetic_training: true,
        execution_provenance: 'SYNTHETIC_TRAINING_ONLY',
      }));
    } finally {
      mockQueueRows = [];
      if (previousTrainingTenant === undefined) delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
      else process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = previousTrainingTenant;
    }
  });

  it('labels a direct detection-results response after durable synthetic verification', async () => {
    const previousTrainingTenant = process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = '22222222-2222-4222-8222-222222222222';
    mockQueueRows = [{
      id: 'queue-2',
      sync_id: 'synthetic_csv_124',
      status: 'completed',
      payload: { execution_provenance: 'SYNTHETIC_TRAINING_ONLY' },
    }];

    try {
      const response = await request(app)
        .get('/api/v1/integrations/detections/results?syncId=synthetic_csv_124')
        .set('x-tenant-id', '22222222-2222-4222-8222-222222222222');

      expect(response.status).toBe(200);
      expect(response.body.meta).toEqual(expect.objectContaining({
        syntheticTraining: true,
        executionProvenance: 'SYNTHETIC_TRAINING_ONLY',
      }));
    } finally {
      mockQueueRows = [];
      if (previousTrainingTenant === undefined) delete process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID;
      else process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = previousTrainingTenant;
    }
  });

  it.each([
    { syncId: 'synthetic_csv_123', metadata: undefined, label: 'synthetic sync prefix' },
    { syncId: 'csv_123', metadata: { syntheticExecution: { provenance: 'SYNTHETIC_TRAINING_ONLY' } }, label: 'synthetic context object' },
    { syncId: 'csv_123', metadata: { executionProvenance: 'SYNTHETIC_TRAINING_ONLY' }, label: 'camel-case provenance' },
    { syncId: 'csv_123', metadata: { execution_provenance: 'SYNTHETIC_TRAINING_ONLY' }, label: 'queue-style provenance' },
  ])('rejects $label before detector invocation', async ({ syncId, metadata }) => {
    triggerDetectionPipeline.mockReset();

    const response = await request(app)
      .post('/api/v1/integrations/detections/run')
      .send({ syncId, triggerType: 'csv_upload', metadata });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'SYNTHETIC_ROUTE_REQUIRED' }),
    }));
    expect(triggerDetectionPipeline).not.toHaveBeenCalled();
  });
});
