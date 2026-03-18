import express from 'express';
import { describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

jest.mock('../../src/database/supabaseClient', () => ({
  isRealDatabaseConfigured: false,
}));

jest.mock('../../src/services/csvIngestionService', () => ({
  csvIngestionService: {
    ingestFiles: jest.fn(),
    getSupportedTypes: jest.fn(() => []),
  },
}));

import csvUploadRoutes from '../../src/routes/csvUploadRoutes';

describe('CSV routes real DB enforcement', () => {
  it('fails honestly when real DB is not configured', async () => {
    const app = express();
    app.use((req: any, _res, next) => {
      req.userId = '11111111-1111-4111-8111-111111111111';
      req.tenant = { tenantId: '22222222-2222-4222-8222-222222222222', tenantStatus: 'active' };
      next();
    });
    app.use('/api/csv-upload', csvUploadRoutes);

    const res = await request(app).post('/api/csv-upload/ingest');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(String(res.body.error || '')).toContain('real database');
  });
});
