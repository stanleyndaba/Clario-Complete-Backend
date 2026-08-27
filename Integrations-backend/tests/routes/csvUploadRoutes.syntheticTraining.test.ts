import express from 'express';
import { describe, expect, beforeEach, it, jest } from '@jest/globals';
import request from 'supertest';

const ingestFiles: any = jest.fn();
const ingestSyntheticTrainingFiles: any = jest.fn();
const createOrResumeCsvAuditFromSync: any = jest.fn();
const isEnabled: any = jest.fn(async () => true);
const getIntakeAdmissionDecision: any = jest.fn(async () => ({ allowed: true, reason: null, metrics: {} }));

jest.mock('../../src/database/supabaseClient', () => ({ isRealDatabaseConfigured: true }));
jest.mock('../../src/services/csvIngestionService', () => ({
  csvIngestionService: {
    ingestFiles,
    ingestSyntheticTrainingFiles,
    getSupportedTypes: jest.fn(() => []),
  },
}));
jest.mock('../../src/services/auditRunService', () => ({
  __esModule: true,
  default: { createOrResumeCsvAuditFromSync },
}));
jest.mock('../../src/services/operationalControlService', () => ({
  __esModule: true,
  default: { isEnabled },
}));
jest.mock('../../src/services/capacityGovernanceService', () => ({
  __esModule: true,
  default: { getIntakeAdmissionDecision },
}));
jest.mock('../../src/services/runtimeCapacityService', () => ({
  __esModule: true,
  default: {
    setCircuitBreaker: jest.fn(),
    getSnapshot: jest.fn(() => ({ circuitBreakers: [] })),
  },
}));

import csvUploadRoutes from '../../src/routes/csvUploadRoutes';
import { SyntheticTrainingAuthorizationError } from '../../src/services/syntheticAuditExecutionContext';

const TRAINING_TENANT = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function createApp(options: { userId?: string | null; tenantId?: string | null; tenantStatus?: 'active' | 'suspended' } = {}) {
  const app = express();
  app.use((req: any, _res, next) => {
    req.userId = options.userId === undefined ? USER_ID : options.userId;
    if (options.tenantId === undefined ? true : Boolean(options.tenantId)) {
      req.tenant = {
        tenantId: options.tenantId === undefined ? TRAINING_TENANT : options.tenantId,
        tenantStatus: options.tenantStatus || 'active',
        tenantName: 'Synthetic training',
        tenantSlug: 'synthetic-training',
        tenantPlan: 'free',
        userRole: 'owner',
      };
    }
    next();
  });
  app.use('/api/csv-upload', csvUploadRoutes);
  return app;
}

function attachCanonicalCsv(requestBuilder: request.Test) {
  return requestBuilder.attach('files', Buffer.from('Order ID,Quantity\nSYN-ORDER-1,1\n'), 'orders_control.csv');
}

describe('synthetic training multipart route contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ingestSyntheticTrainingFiles.mockResolvedValue({ success: true, syncId: 'synthetic_csv_route_test', results: [] });
    ingestFiles.mockResolvedValue({ success: true, syncId: 'csv_route_test', results: [] });
    createOrResumeCsvAuditFromSync.mockResolvedValue({ id: 'audit-test' });
  });

  it('rejects a multipart request that omits the required synthetic provenance header before ingestion', async () => {
    const response = await attachCanonicalCsv(request(createApp()).post('/api/csv-upload/synthetic-training/ingest'));

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SYNTHETIC_TRAINING_PROVENANCE_REQUIRED');
    expect(response.body.error).toContain('SYNTHETIC_TRAINING_ONLY provenance header');
    expect(ingestSyntheticTrainingFiles).not.toHaveBeenCalled();
    expect(ingestFiles).not.toHaveBeenCalled();
  });

  it('rejects an incorrect provenance header before ingestion', async () => {
    const response = await attachCanonicalCsv(
      request(createApp())
        .post('/api/csv-upload/synthetic-training/ingest')
        .set('x-margin-execution-provenance', 'ordinary_csv'),
    );

    expect(response.status).toBe(403);
    expect(ingestSyntheticTrainingFiles).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated multipart request even when the required provenance header is present', async () => {
    const response = await attachCanonicalCsv(
      request(createApp({ userId: null }))
        .post('/api/csv-upload/synthetic-training/ingest')
        .set('x-margin-execution-provenance', 'SYNTHETIC_TRAINING_ONLY'),
    );

    expect(response.status).toBe(401);
    expect(ingestSyntheticTrainingFiles).not.toHaveBeenCalled();
  });

  it('returns the exact safe configuration code when synthetic tenant authorization rejects after valid browser transport', async () => {
    ingestSyntheticTrainingFiles.mockRejectedValueOnce(new SyntheticTrainingAuthorizationError(
      'SYNTHETIC_TRAINING_TENANT_MISMATCH',
      'Synthetic training execution is restricted to the configured training tenant.',
    ));

    const response = await attachCanonicalCsv(
      request(createApp())
        .post('/api/csv-upload/synthetic-training/ingest')
        .set('x-margin-execution-provenance', 'SYNTHETIC_TRAINING_ONLY'),
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({
      success: false,
      code: 'SYNTHETIC_TRAINING_TENANT_MISMATCH',
      error: 'Synthetic training execution is restricted to the configured training tenant.',
    }));
    expect(ingestFiles).not.toHaveBeenCalled();
  });

  it('accepts an authenticated multipart request with the exact provenance header and calls only synthetic ingestion', async () => {
    const response = await attachCanonicalCsv(
      request(createApp())
        .post('/api/csv-upload/synthetic-training/ingest')
        .set('x-margin-execution-provenance', 'SYNTHETIC_TRAINING_ONLY'),
    );

    expect(response.status).toBe(200);
    expect(response.body.training).toEqual({
      provenance: 'SYNTHETIC_TRAINING_ONLY',
      label: 'SYNTHETIC TRAINING ONLY',
      commercialSuppressed: true,
    });
    expect(ingestSyntheticTrainingFiles).toHaveBeenCalledWith(
      USER_ID,
      expect.arrayContaining([expect.objectContaining({ originalname: 'orders_control.csv' })]),
      expect.objectContaining({ tenantId: TRAINING_TENANT, triggerDetection: true }),
    );
    expect(ingestFiles).not.toHaveBeenCalled();
  });

  it('creates a limited manual audit for a mixed batch only when a valid file produced usable rows and detection began', async () => {
    ingestFiles.mockResolvedValueOnce({
      success: false,
      syncId: 'csv_route_partial_test',
      detectionTriggered: true,
      results: [
        { success: true, fileName: 'orders_valid.csv', rowsInserted: 1 },
        { success: false, fileName: 'orders_ambiguous.csv', rowsInserted: 0, inputIssue: 'ambiguous' },
      ],
    });

    const response = await attachCanonicalCsv(request(createApp()).post('/api/csv-upload/ingest'));

    expect(response.status).toBe(207);
    expect(response.body.manualAudit).toEqual({ id: 'audit-test' });
    expect(createOrResumeCsvAuditFromSync).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      tenantId: TRAINING_TENANT,
      syncId: 'csv_route_partial_test',
    }));
  });

  it('returns duplicate-reused truth without creating a second manual audit for a duplicate-only multipart replay', async () => {
    ingestFiles.mockResolvedValueOnce({
      success: false,
      syncId: 'csv_route_duplicate_retry',
      submissionDisposition: 'duplicate_reused',
      detectionTriggered: false,
      results: [
        {
          success: true,
          fileName: 'orders_copy.csv',
          rowsInserted: 0,
          rowsSkipped: 1,
          errors: ['Duplicate file upload detected; ingestion skipped.'],
          detectionTriggered: false,
        },
      ],
    });

    const response = await attachCanonicalCsv(request(createApp()).post('/api/csv-upload/ingest'));

    expect(response.status).toBe(207);
    expect(response.body).toEqual(expect.objectContaining({
      submissionDisposition: 'duplicate_reused',
      detectionTriggered: false,
      manualAudit: null,
    }));
    expect(createOrResumeCsvAuditFromSync).not.toHaveBeenCalled();
  });

  it('does not create a manual audit when every uploaded file was rejected or empty', async () => {
    ingestFiles.mockResolvedValueOnce({
      success: false,
      syncId: 'csv_route_rejected_test',
      detectionTriggered: false,
      results: [
        { success: false, fileName: 'orders_malformed.csv', rowsInserted: 0, inputIssue: 'malformed' },
        { success: false, fileName: 'unknown.csv', rowsInserted: 0, inputIssue: 'unsupported' },
      ],
    });

    const response = await attachCanonicalCsv(request(createApp()).post('/api/csv-upload/ingest'));

    expect(response.status).toBe(207);
    expect(response.body.manualAudit).toBeNull();
    expect(createOrResumeCsvAuditFromSync).not.toHaveBeenCalled();
  });

  it('keeps the ordinary CSV route ordinary even if a caller injects synthetic provenance metadata', async () => {
    const response = await attachCanonicalCsv(
      request(createApp())
        .post('/api/csv-upload/ingest')
        .set('x-margin-execution-provenance', 'SYNTHETIC_TRAINING_ONLY'),
    );

    expect(response.status).toBe(200);
    expect(ingestFiles).toHaveBeenCalled();
    expect(ingestSyntheticTrainingFiles).not.toHaveBeenCalled();
  });
});
