import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import auditRunService from '../../src/services/auditRunService';
import { supabaseAdmin } from '../../src/database/supabaseClient';

jest.mock('../../src/database/supabaseClient', () => ({
  convertUserIdToUuid: (value: string) => value,
  supabaseAdmin: { from: jest.fn() },
}));

jest.mock('../../src/services/workspaceEntitlementService', () => ({
  __esModule: true,
  default: { getTenantEntitlement: jest.fn(async () => ({ entitlement: { entitled: false } })) },
}));

function chain(result: any) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    gte: jest.fn(() => query),
    order: jest.fn(() => query),
    limit: jest.fn(() => query),
    neq: jest.fn(() => query),
    maybeSingle: jest.fn(async () => result),
    then: (resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

const tenantId = '22222222-2222-4222-8222-222222222222';
const userId = '11111111-1111-4111-8111-111111111111';
const syncId = 'synthetic_csv_read_model_001';

const canonicalUploadRun = {
  sync_id: syncId,
  tenant_id: tenantId,
  seller_id: userId,
  total_files: 7,
  file_count: 7,
  files_summary: [
    { fileName: 'orders_control.csv', status: 'ingested', csvType: 'orders', rowsProcessed: 3, rowsInserted: 3, rowsSkipped: 0, rowsFailed: 0 },
    { fileName: 'shipments_control.csv', status: 'ingested', csvType: 'shipments', rowsProcessed: 3, rowsInserted: 3, rowsSkipped: 0, rowsFailed: 0 },
    { fileName: 'returns_control.csv', status: 'ingested', csvType: 'returns', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
    { fileName: 'settlements_control.csv', status: 'ingested', csvType: 'settlements', rowsProcessed: 3, rowsInserted: 3, rowsSkipped: 0, rowsFailed: 0 },
    { fileName: 'financial_events_control.csv', status: 'ingested', csvType: 'financial_events', rowsProcessed: 3, rowsInserted: 3, rowsSkipped: 0, rowsFailed: 0 },
    { fileName: 'fees_control.csv', status: 'ingested', csvType: 'fees', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
    { fileName: 'inventory_ledger_control.txt', status: 'ingested', csvType: 'inventory', rowsProcessed: 4, rowsInserted: 4, rowsSkipped: 0, rowsFailed: 0 },
  ],
};

const completedSyntheticAudit = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user_id: userId,
  tenant_id: tenantId,
  sync_id: syncId,
  source_type: 'csv_upload',
  status: 'completed',
  activation_status: 'not_activated',
  started_at: '2026-08-26T13:40:00.000Z',
  completed_at: '2026-08-26T13:41:00.000Z',
  created_at: '2026-08-26T13:40:00.000Z',
  updated_at: '2026-08-26T13:41:00.000Z',
  summary: {
    syntheticTraining: true,
    executionProvenance: 'SYNTHETIC_TRAINING_ONLY',
    trainingLabel: 'SYNTHETIC TRAINING ONLY',
    commercialSuppressed: true,
  },
};

describe('auditRunService manual report read model', () => {
  const service: any = auditRunService;

  beforeEach(() => {
    process.env.MARGIN_SYNTHETIC_TRAINING_TENANT_ID = tenantId;
    jest.clearAllMocks();
    jest.restoreAllMocks();
    service.getAudit = jest.fn(async () => ({ ...completedSyntheticAudit }));
    service.getSyncStatus = jest.fn(async () => null);
    service.getCsvUploadRunForAudit = jest.fn(async () => ({ ...canonicalUploadRun }));
    service.updateAudit = jest.fn(async (_id: string, patch: any) => ({ ...completedSyntheticAudit, ...patch }));
  });

  it('returns durable manual report processing facts when no connected-Amazon sync row exists', async () => {
    (supabaseAdmin.from as any).mockReturnValue(chain({
      data: [{ anomaly_type: 'reimbursement_duplicate_missed', estimated_value: 0, claim_readiness: 'review_only' }],
      error: null,
    }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);

    expect(service.getSyncStatus).not.toHaveBeenCalled();
    expect(result.teaser).toMatchObject({
      syntheticTraining: true,
      trainingLabel: 'SYNTHETIC TRAINING ONLY',
      commercialSuppressed: true,
      recordsReviewed: 20,
      reviewOnlyCount: 1,
      finalStatus: 'partial_with_findings',
    });
    expect(result.teaser.manualReport).toMatchObject({
      source: 'manual_upload',
      filesReceived: 7,
      filesAccepted: 7,
      filesProcessed: 7,
      filesFailed: 0,
      rowsParsed: 20,
      rowsAccepted: 20,
      rowsSkipped: 0,
      rowsRejected: 0,
      sourceFamilies: expect.arrayContaining(['Orders', 'Shipments', 'Returns', 'Settlements', 'Financial events', 'Fees', 'Inventory ledger']),
    });
    expect(result.teaser.message).toContain('no connected Amazon data was used for this audit.');
    expect(result.teaser.message).toMatch(/^SYNTHETIC TRAINING ONLY — Margin processed/);
    expect(result.teaser.message).not.toContain('SYNTHETIC TRAINING ONLY — SYNTHETIC TRAINING ONLY');
    expect(result.commercial).toEqual({ suppressed: true, reason: 'SYNTHETIC_TRAINING_ONLY' });
  });

  it('classifies canonical manual sources as complete for supported report coverage while keeping unsupported inbound evidence unavailable', async () => {
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: [], error: null }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);

    expect(result.teaser.manualCoverage).toMatchObject({
      source: 'manual_upload',
      overallStatus: 'complete',
      evaluatedAreas: expect.arrayContaining(['whale_hunter', 'refund_trap', 'broken_goods', 'fee_phantom', 'sentinel']),
      unavailableAreas: ['inbound_inspector'],
    });
    expect(result.teaser.manualCoverage.areas).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'fee_phantom', status: 'supported', monetaryConclusion: 'within_covered_evidence' }),
      expect.objectContaining({ key: 'inbound_inspector', status: 'unavailable', monetaryConclusion: 'unknown_outside_coverage' }),
    ]));
  });

  it.each([
    {
      id: 'COV-SUBSET-A-RETURNS-SETTLEMENTS',
      files: [
        { fileName: 'returns.csv', status: 'ingested', csvType: 'returns', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
        { fileName: 'settlements.csv', status: 'ingested', csvType: 'settlements', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
      ],
      expectedSupported: ['broken_goods'],
      expectedPartial: ['whale_hunter', 'refund_trap', 'sentinel'],
      expectedUnavailable: ['fee_phantom', 'inbound_inspector'],
    },
    {
      id: 'COV-SUBSET-B-FEES-FINANCIAL',
      files: [
        { fileName: 'fees.csv', status: 'ingested', csvType: 'fees', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
        { fileName: 'financial.csv', status: 'ingested', csvType: 'financial_events', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
      ],
      expectedSupported: ['fee_phantom'],
      expectedPartial: ['whale_hunter', 'sentinel'],
      expectedUnavailable: ['refund_trap', 'broken_goods', 'inbound_inspector'],
    },
    {
      id: 'COV-MINIMAL-ORDERS-ONLY',
      files: [
        { fileName: 'orders.csv', status: 'ingested', csvType: 'orders', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
      ],
      expectedSupported: [],
      expectedPartial: ['refund_trap'],
      expectedUnavailable: ['whale_hunter', 'broken_goods', 'fee_phantom', 'inbound_inspector', 'sentinel'],
    },
  ])('keeps $0 partial coverage distinct from no-recovery claims for $id', async ({ files, expectedSupported, expectedPartial, expectedUnavailable }) => {
    service.getAudit = jest.fn(async () => ({
      ...completedSyntheticAudit,
      sync_id: 'csv_read_model_s2_partial',
      summary: {},
      commercial_state: 'read_model_only',
    }));
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'csv_read_model_s2_partial',
      file_count: files.length,
      files_summary: files,
    }));
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: [], error: null }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);
    const byKey = Object.fromEntries(result.teaser.manualCoverage.areas.map((area: any) => [area.key, area]));

    expect(result.teaser).toMatchObject({
      scopeValue: 0,
      findingsCount: 0,
      finalStatus: 'partial_no_findings',
      dataTruthState: 'limited_coverage',
    });
    expect(result.teaser.message).toContain('Coverage is limited to the reports and periods provided');
    expect(result.teaser.message).not.toMatch(/no recover(?:y|ies)/i);
    expect(result.teaser.manualCoverage).toMatchObject({ overallStatus: 'partial' });
    for (const key of expectedSupported) {
      expect(byKey[key]).toMatchObject({ status: 'supported', monetaryConclusion: 'within_covered_evidence' });
    }
    for (const key of expectedPartial) {
      expect(byKey[key]).toMatchObject({ status: 'partial', monetaryConclusion: 'unknown_outside_coverage' });
    }
    for (const key of expectedUnavailable) {
      expect(byKey[key]).toMatchObject({ status: 'unavailable', monetaryConclusion: 'unknown_outside_coverage' });
    }
  });

  it('classifies accepted zero-row manual reports as no data rather than a no-findings conclusion', async () => {
    service.getAudit = jest.fn(async () => ({
      ...completedSyntheticAudit,
      sync_id: 'csv_read_model_s2_no_data',
      summary: {},
      commercial_state: 'read_model_only',
    }));
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'csv_read_model_s2_no_data',
      file_count: 1,
      files_summary: [
        { fileName: 'orders-empty.csv', status: 'ingested', csvType: 'orders', rowsProcessed: 0, rowsInserted: 0, rowsSkipped: 0, rowsFailed: 0 },
      ],
    }));
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: [], error: null }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);

    expect(result.teaser).toMatchObject({
      recordsReviewed: 0,
      scopeValue: 0,
      findingsCount: 0,
      finalStatus: 'partial_no_findings',
      dataTruthState: 'limited_coverage',
    });
    expect(result.teaser.manualCoverage).toMatchObject({
      overallStatus: 'no_data',
      evaluatedAreas: ['refund_trap'],
    });
    expect(result.teaser.manualCoverage.areas).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'refund_trap', status: 'partial', monetaryConclusion: 'unknown_outside_coverage' }),
    ]));
  });

  it('retains safe malformed, ambiguous, unsupported, empty, and prohibited file classifications in a valid mixed-batch audit', async () => {
    service.getAudit = jest.fn(async () => ({
      ...completedSyntheticAudit,
      sync_id: 'csv_read_model_s3_mixed',
      summary: {},
      commercial_state: 'read_model_only',
    }));
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'csv_read_model_s3_mixed',
      file_count: 6,
      files_summary: [
        { fileName: 'orders-valid.csv', status: 'ingested', csvType: 'orders', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
        { fileName: 'orders-malformed.csv', status: 'failed', csvType: 'orders', rowsProcessed: 0, rowsInserted: 0, rowsSkipped: 0, rowsFailed: 0, inputIssue: 'malformed', errors: ['internal parser trace must not be exposed'] },
        { fileName: 'ambiguous.csv', status: 'failed', csvType: 'unknown', rowsProcessed: 0, rowsInserted: 0, rowsSkipped: 0, rowsFailed: 0, inputIssue: 'ambiguous' },
        { fileName: 'unsupported.csv', status: 'failed', csvType: 'unknown', rowsProcessed: 1, rowsInserted: 0, rowsSkipped: 0, rowsFailed: 0, inputIssue: 'unsupported' },
        { fileName: 'empty.csv', status: 'failed', csvType: 'unknown', rowsProcessed: 0, rowsInserted: 0, rowsSkipped: 0, rowsFailed: 0, inputIssue: 'empty' },
        { fileName: 'transfers-prohibited.csv', status: 'failed', csvType: 'transfers', rowsProcessed: 2, rowsInserted: 0, rowsSkipped: 2, rowsFailed: 2, inputIssue: 'prohibited' },
      ],
    }));
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: [], error: null }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);
    const filesByName = Object.fromEntries(result.teaser.manualReport.files.map((file: any) => [file.fileName, file]));

    expect(result.teaser).toMatchObject({
      recordsReviewed: 2,
      scopeValue: 0,
      findingsCount: 0,
      finalStatus: 'partial_no_findings',
      dataTruthState: 'limited_coverage',
    });
    expect(result.teaser.manualReport).toMatchObject({
      filesReceived: 6,
      filesProcessed: 1,
      filesFailed: 5,
      sourceFamilies: ['Orders'],
    });
    expect(filesByName['orders-malformed.csv']).toMatchObject({
      inputIssue: 'malformed',
      errorSummary: 'The file structure could not be safely interpreted.',
    });
    expect(filesByName['ambiguous.csv']).toMatchObject({
      inputIssue: 'ambiguous',
      errorSummary: 'The headers match more than one supported report family, so Margin did not guess a mapping.',
    });
    expect(filesByName['unsupported.csv']).toMatchObject({
      inputIssue: 'unsupported',
      errorSummary: 'The file structure does not match a supported report family.',
    });
    expect(filesByName['empty.csv']).toMatchObject({
      inputIssue: 'empty',
      errorSummary: 'The file was accepted, but it contained no usable data rows.',
    });
    expect(filesByName['transfers-prohibited.csv']).toMatchObject({
      inputIssue: 'prohibited',
      sourceFamily: 'Transfers',
      rowsAccepted: 0,
      rowsRejected: 2,
      errorSummary: 'This file contains Transfer evidence, which Margin cannot accept while Transfer is OFF. It was not used for this audit.',
    });
    expect(JSON.stringify(result.teaser.manualReport)).not.toContain('internal parser trace');
    expect(result.teaser.message).not.toMatch(/no recover(?:y|ies)/i);
  });

  it('reports no usable temporal coverage when historical temporal facts are absent or corrupt', async () => {
    service.getAudit = jest.fn(async () => ({ ...completedSyntheticAudit, sync_id: 'synthetic_csv_s6_no_dates', summary: completedSyntheticAudit.summary }));
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'synthetic_csv_s6_no_dates', file_count: 3,
      files_summary: [
        { fileName: 'orders-no-temporal.csv', status: 'ingested', csvType: 'orders', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0 },
        { fileName: 'returns-corrupt-temporal.csv', status: 'failed', csvType: 'returns', rowsProcessed: 1, rowsInserted: 0, rowsSkipped: 1, rowsFailed: 0, inputIssue: 'invalid_value', temporalEvidence: { status: 'available', sourceDateField: 'returned_date', earliestAt: '2026-08-01', latestAt: 'not-a-date', observedDateCount: 1 } },
        { fileName: 'snapshot-no-date.csv', status: 'ingested', csvType: 'inventory', rowsProcessed: 1, rowsInserted: 1, rowsSkipped: 0, rowsFailed: 0, temporalEvidence: { status: 'unavailable', sourceDateField: null, earliestAt: null, latestAt: null, observedDateCount: 0 } },
      ],
    }));
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: [], error: null }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);
    const corrupt = result.teaser.manualReport.files.find((file: any) => file.fileName === 'returns-corrupt-temporal.csv');
    expect(result.teaser.manualCoverage.temporal).toEqual(expect.objectContaining({
      overallStatus: 'no_usable_temporal_evidence', suppliedPeriod: null, requestedPeriod: 'not_recorded', continuity: 'unknown', datedFiles: 0, unavailableFiles: 3, overlapDetected: false,
    }));
    expect(result.teaser.manualCoverage.temporal.reason).toContain('does not establish a covered period');
    expect(corrupt.temporalEvidence).toMatchObject({ status: 'unavailable', earliestAt: null, latestAt: null });
    expect(result.teaser.message).not.toMatch(/no recover(?:y|ies)/i);
  });

  it('keeps a $0 result with accepted 01–15 August facts as partial evidence rather than a complete or no-recovery conclusion', async () => {
    service.getAudit = jest.fn(async () => ({ ...completedSyntheticAudit, sync_id: 'synthetic_csv_s6_august_partial', summary: completedSyntheticAudit.summary }));
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'synthetic_csv_s6_august_partial', file_count: 1,
      files_summary: [{ fileName: 'orders-august-01-15.csv', status: 'ingested', csvType: 'orders', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0, temporalEvidence: { status: 'available', sourceDateField: 'order_date', earliestAt: '2026-08-01T00:00:00.000Z', latestAt: '2026-08-15T23:59:59.000Z', observedDateCount: 2, continuity: 'unknown' } }],
    }));
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: [], error: null }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);
    expect(result.teaser).toMatchObject({ scopeValue: 0, findingsCount: 0, finalStatus: 'partial_no_findings', dataTruthState: 'limited_coverage' });
    expect(result.teaser.manualCoverage.temporal).toEqual(expect.objectContaining({
      overallStatus: 'partial', suppliedPeriod: { earliestAt: '2026-08-01T00:00:00.000Z', latestAt: '2026-08-15T23:59:59.000Z' }, requestedPeriod: 'not_recorded', continuity: 'unknown', datedFiles: 1, unavailableFiles: 0, partialFiles: 0,
    }));
    expect(result.teaser.manualCoverage.temporal.reason).toContain('continuous day-by-day coverage were not recorded');
    expect(result.teaser.message).toContain('Coverage is limited to the reports and periods provided');
    expect(result.teaser.message).not.toMatch(/no recover(?:y|ies)/i);
  });

  it('records outer date bounds while retaining unknown continuity for gaps, overlaps, mixed partial evidence, and renamed duplicates', async () => {
    service.getAudit = jest.fn(async () => ({ ...completedSyntheticAudit, sync_id: 'synthetic_csv_s6_gap_overlap', summary: completedSyntheticAudit.summary }));
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'synthetic_csv_s6_gap_overlap', file_count: 5,
      files_summary: [
        { fileName: 'orders-01-10.csv', status: 'ingested', csvType: 'orders', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0, temporalEvidence: { status: 'available', sourceDateField: 'order_date', earliestAt: '2026-08-01T00:00:00.000Z', latestAt: '2026-08-10T00:00:00.000Z', observedDateCount: 2 } },
        { fileName: 'returns-21-31.csv', status: 'ingested', csvType: 'returns', rowsProcessed: 2, rowsInserted: 2, rowsSkipped: 0, rowsFailed: 0, temporalEvidence: { status: 'available', sourceDateField: 'returned_date', earliestAt: '2026-08-21T00:00:00.000Z', latestAt: '2026-08-31T23:59:59.000Z', observedDateCount: 2 } },
        { fileName: 'fees-10-25.csv', status: 'ingested', csvType: 'fees', rowsProcessed: 2, rowsInserted: 1, rowsSkipped: 1, rowsFailed: 0, temporalEvidence: { status: 'partial', sourceDateField: 'event_date', earliestAt: '2026-08-10T00:00:00.000Z', latestAt: '2026-08-25T00:00:00.000Z', observedDateCount: 1 } },
        { fileName: 'invalid-date.csv', status: 'failed', csvType: 'settlements', rowsProcessed: 1, rowsInserted: 0, rowsSkipped: 1, rowsFailed: 0, inputIssue: 'invalid_value', temporalEvidence: { status: 'unavailable', sourceDateField: 'settlement_date', earliestAt: null, latestAt: null, observedDateCount: 0 } },
        { fileName: 'renamed-duplicate.csv', status: 'duplicate', csvType: 'orders', rowsProcessed: 2, rowsInserted: 0, rowsSkipped: 2, rowsFailed: 0, temporalEvidence: { status: 'available', sourceDateField: 'order_date', earliestAt: '2025-01-01T00:00:00.000Z', latestAt: '2027-01-01T00:00:00.000Z', observedDateCount: 2 } },
      ],
    }));
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: [], error: null }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);
    expect(result.teaser.manualCoverage.temporal).toEqual(expect.objectContaining({
      overallStatus: 'partial', suppliedPeriod: { earliestAt: '2026-08-01T00:00:00.000Z', latestAt: '2026-08-31T23:59:59.000Z' }, requestedPeriod: 'not_recorded', continuity: 'unknown', datedFiles: 3, unavailableFiles: 1, partialFiles: 1, overlapDetected: true,
    }));
    expect(result.teaser.manualCoverage.temporal.reason).toContain('accepted source dates only');
    expect(result.teaser.manualCoverage.temporal.reason).toContain('conditions outside represented dates remain unknown');
    expect(result.teaser.manualReport.files.find((file: any) => file.fileName === 'renamed-duplicate.csv').temporalEvidence).toMatchObject({ earliestAt: '2025-01-01T00:00:00.000Z' });
  });

  it('keeps source-family absence distinct from zero processing in a partial manual report run', async () => {
    service.getAudit = jest.fn(async () => ({
      ...completedSyntheticAudit,
      sync_id: 'csv_read_model_partial_001',
      summary: {},
      commercial_state: 'read_model_only',
    }));
    service.getCsvUploadRunForAudit = jest.fn(async () => ({
      sync_id: 'csv_read_model_partial_001',
      file_count: 2,
      files_summary: [
        { fileName: 'orders.csv', status: 'ingested', csvType: 'orders', rowsProcessed: 5, rowsInserted: 4, rowsSkipped: 1, rowsFailed: 0 },
        { fileName: 'fees.csv', status: 'failed', csvType: 'fees', rowsProcessed: 2, rowsInserted: 0, rowsSkipped: 1, rowsFailed: 1 },
      ],
    }));
    (supabaseAdmin.from as any).mockReturnValue(chain({ data: [], error: null }));

    const result = await service.getResults(completedSyntheticAudit.id, userId, tenantId);

    expect(result.teaser.manualReport).toMatchObject({
      filesReceived: 2,
      filesAccepted: 1,
      filesProcessed: 1,
      filesFailed: 1,
      rowsParsed: 7,
      rowsAccepted: 4,
      rowsSkipped: 2,
      rowsRejected: 1,
      sourceFamilies: ['Orders'],
    });
    expect(result.teaser.manualReport.sourceFamiliesNotRepresented).toEqual(expect.arrayContaining(['Fees', 'Inventory ledger']));
    expect(result.teaser.recordsReviewed).toBe(4);
    expect(result.teaser.finalStatus).toBe('partial_no_findings');
  });

  it('uses uploaded-report processing language in manual audit activity', async () => {
    const manualAudit = {
      ...completedSyntheticAudit,
      sync_id: 'csv_read_model_activity_001',
      summary: {
        recordsReviewed: 20,
        findingsCount: 0,
        sourcesReviewed: ['Orders', 'Fees'],
        sourcesUnavailable: ['Inventory ledger'],
        manualReport: {
          source: 'manual_upload',
          filesReceived: 2,
          filesAccepted: 2,
          filesProcessed: 2,
          filesFailed: 0,
          rowsParsed: 20,
          rowsAccepted: 19,
          rowsSkipped: 1,
          rowsRejected: 0,
          sourceFamilies: ['Orders', 'Fees'],
          sourceFamiliesNotRepresented: ['Inventory ledger'],
          files: [],
        },
      },
    };
    service.getAudit = jest.fn(async () => manualAudit);

    const activity = await service.getActivity(manualAudit.id, userId, tenantId);

    expect(activity.map((event: any) => event.message).join(' ')).toContain('uploaded files processed; 19 rows accepted from 20 parsed');
    expect(activity.map((event: any) => event.message).join(' ')).not.toContain('Amazon records');
  });

  it('uses a core-field history query and retains synthetic labeling without commercial columns', async () => {
    const historyQuery = chain({ data: [completedSyntheticAudit], error: null });
    (supabaseAdmin.from as any).mockReturnValue(historyQuery);

    const history = await service.getAuditHistory(userId, 18, tenantId);

    expect(historyQuery.select).toHaveBeenCalledWith(expect.not.stringContaining('commercial_route'));
    expect(historyQuery.eq).toHaveBeenCalledWith('tenant_id', tenantId);
    expect(history).toEqual([expect.objectContaining({
      id: completedSyntheticAudit.id,
      syntheticTraining: true,
      finalStatus: 'synthetic_training_only',
      findingsCount: 0,
      scopeValue: 0,
    })]);
  });

  it('returns durable manual-report processing facts in audit history', async () => {
    const manualHistoryAudit = {
      ...completedSyntheticAudit,
      sync_id: 'csv_read_model_history_001',
      summary: {
        recordsReviewed: 0,
        manualReport: {
          source: 'manual_upload',
          filesReceived: 2,
          filesAccepted: 2,
          filesProcessed: 2,
          filesFailed: 0,
          rowsParsed: 11,
          rowsAccepted: 10,
          rowsSkipped: 1,
          rowsRejected: 0,
          sourceFamilies: ['Orders', 'Fees'],
          sourceFamiliesNotRepresented: ['Returns'],
          files: [],
        },
      },
    };
    const historyQuery = chain({ data: [manualHistoryAudit], error: null });
    (supabaseAdmin.from as any).mockReturnValue(historyQuery);

    const history = await service.getAuditHistory(userId, 18, tenantId);

    expect(history[0]).toMatchObject({
      sourceType: 'csv_upload',
      recordsReviewed: 10,
      manualReport: {
        source: 'manual_upload',
        filesProcessed: 2,
        rowsAccepted: 10,
      },
    });
  });

  it('keeps audit retrieval tenant-scoped', async () => {
    delete service.getAudit;
    const detailQuery = chain({ data: null, error: null });
    (supabaseAdmin.from as any).mockReturnValue(detailQuery);

    await expect(auditRunService.getAudit(completedSyntheticAudit.id, userId, '33333333-3333-4333-8333-333333333333'))
      .rejects.toThrow('Audit run not found');
    expect(detailQuery.eq).toHaveBeenCalledWith('tenant_id', '33333333-3333-4333-8333-333333333333');
  });
});


describe('manual audit test-mode eligibility guard', () => {
  const service: any = auditRunService;
  const futureAudit = { next_eligible_at: '2099-01-01T00:00:00.000Z' };
  const originalTestMode = process.env.MANUAL_AUDIT_TEST_MODE;
  const originalUnlimited = process.env.MANUAL_AUDIT_UNLIMITED;

  afterEach(() => {
    if (originalTestMode === undefined) delete process.env.MANUAL_AUDIT_TEST_MODE;
    else process.env.MANUAL_AUDIT_TEST_MODE = originalTestMode;
    if (originalUnlimited === undefined) delete process.env.MANUAL_AUDIT_UNLIMITED;
    else process.env.MANUAL_AUDIT_UNLIMITED = originalUnlimited;
  });

  it('bypasses the next eligible date only for explicit manual-audit test mode', () => {
    process.env.MANUAL_AUDIT_TEST_MODE = 'true';
    process.env.MANUAL_AUDIT_UNLIMITED = 'true';
    expect(() => service.assertFreeAuditEligible(futureAudit, 'csv_upload')).not.toThrow();
  });

  it('keeps the production guard active when the flags are absent', () => {
    delete process.env.MANUAL_AUDIT_TEST_MODE;
    delete process.env.MANUAL_AUDIT_UNLIMITED;
    expect(() => service.assertFreeAuditEligible(futureAudit, 'csv_upload')).toThrow('next complimentary manual report audit');
  });

  it('never bypasses connected-Amazon audit eligibility', () => {
    process.env.MANUAL_AUDIT_TEST_MODE = 'true';
    process.env.MANUAL_AUDIT_UNLIMITED = 'true';
    expect(() => service.assertFreeAuditEligible(futureAudit, 'sp_api')).toThrow('next complimentary connected Amazon audit');
  });
});
