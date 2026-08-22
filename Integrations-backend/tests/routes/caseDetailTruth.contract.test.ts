import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, any>;

const TENANT_ID = 'case-detail-tenant';
const TENANT_SLUG = 'case-detail-truth';
const CASE_ID = 'CASE-DETAIL-TRUTH-1';
const tables: Record<string, Row[]> = {};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const financialTruthMock = jest.fn<any>();

jest.mock('../../src/utils/logger', () => ({
  getLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

jest.mock('../../src/database/supabaseClient', () => {
  const matches = (row: Row, filters: Array<(candidate: Row) => boolean>) => filters.every((filter) => filter(row));

  const makeBuilder = (table: string) => {
    const state: {
      filters: Array<(candidate: Row) => boolean>;
      orderBy?: { field: string; ascending: boolean };
      limitCount?: number;
    } = { filters: [] };

    const materialize = () => {
      let rows = [...(tables[table] || [])].filter((row) => matches(row, state.filters));
      if (state.orderBy) {
        const { field, ascending } = state.orderBy;
        rows = rows.sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (ascending ? 1 : -1));
      }
      if (state.limitCount !== undefined) rows = rows.slice(0, state.limitCount);
      return rows;
    };

    const builder: any = {
      select: () => builder,
      eq: (field: string, value: any) => {
        state.filters.push((row) => row[field] === value);
        return builder;
      },
      in: (field: string, values: any[]) => {
        state.filters.push((row) => values.includes(row[field]));
        return builder;
      },
      order: (field: string, options?: { ascending?: boolean }) => {
        state.orderBy = { field, ascending: options?.ascending !== false };
        return builder;
      },
      limit: (count: number) => {
        state.limitCount = count;
        return builder;
      },
      single: () => Promise.resolve({ data: clone(materialize()[0] || null), error: null }),
      maybeSingle: () => Promise.resolve({ data: clone(materialize()[0] || null), error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: clone(materialize()), error: null }).then(resolve, reject),
    };

    return builder;
  };

  return {
    convertUserIdToUuid: (value: string) => value,
    supabaseAdmin: { from: (table: string) => makeBuilder(table) },
  };
});

jest.mock('../../src/services/recoveryFinancialTruthService', () => ({
  __esModule: true,
  default: { getFinancialTruth: financialTruthMock },
  recoveryFinancialTruthService: { getFinancialTruth: financialTruthMock },
}));

jest.mock('../../src/services/amazonCaseThreadService', () => ({
  __esModule: true,
  default: { listCaseMessages: jest.fn(async () => []) },
}));

jest.mock('../../src/services/canonicalEvidenceService', () => ({
  evaluateCanonicalEvidenceTruth: jest.fn(() => ({
    linkedDocumentCount: 0,
    isEvidenceComplete: false,
    requiredRequirements: [],
    missingRequirements: ['proof_snapshot'],
  })),
}));

jest.mock('../../src/services/detectionFindingTruthService', () => ({
  enrichDetectionFinding: jest.fn(),
}));

jest.mock('../../src/services/compositePdfService', () => ({ compositePdfService: {} }));
jest.mock('../../src/services/timelineService', () => ({ timelineService: {} }));
jest.mock('../../src/utils/agent10Event', () => ({ extractAgent10EntityIds: jest.fn(() => []) }));
jest.mock('../../src/notifications/services/notification_service', () => ({ notificationService: {} }));
jest.mock('../../src/notifications/models/notification', () => ({
  NotificationChannel: {},
  NotificationPriority: {},
  NotificationType: {},
}));
jest.mock('../../src/services/financialWorkItemService', () => ({ __esModule: true, default: {} }));
jest.mock('../../src/utils/tenantEventRouting', () => ({ resolveTenantSlug: jest.fn() }));

import recoveryRoutes from '../../src/routes/recoveryRoutes';

function buildCase(overrides: Partial<Row> = {}): Row {
  return {
    id: CASE_ID,
    tenant_id: TENANT_ID,
    seller_id: 'seller-case-detail',
    store_id: 'store-case-detail',
    case_number: 'CASE-DETAIL-TRUTH-REF',
    claim_id: 'CLAIM-DETAIL-TRUTH-REF',
    amazon_case_id: 'AMAZON-CASE-DETAIL-1',
    order_id: 'ORDER-DETAIL-1',
    sku: 'SKU-DETAIL-1',
    asin: 'ASIN-DETAIL-1',
    currency: 'USD',
    status: 'approved',
    case_state: 'approved',
    filing_status: 'filed',
    eligibility_status: 'READY',
    approved_amount: 100,
    claim_amount: 100,
    recovered_amount: 100,
    recovery_status: 'reconciled',
    billing_status: 'pending',
    units_lost: null,
    evidence: { quantity: 3, fnsku: 'FNSKU-DETAIL-1' },
    evidence_attachments: {},
    created_at: '2026-08-20T10:00:00.000Z',
    updated_at: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

function financialSummary(overrides: Partial<Row> = {}) {
  return {
    input_id: CASE_ID,
    dispute_case_id: CASE_ID,
    detection_result_id: null,
    requested_amount: 100,
    approved_amount: 100,
    verified_paid_amount: 0,
    outstanding_amount: 100,
    variance_amount: -100,
    payout_status: 'not_paid',
    financial_event_count: 0,
    reimbursement_event_count: 0,
    settlement_event_count: 0,
    latest_event_date: null,
    proof_of_payment: null,
    source_types: [],
    ...overrides,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenant = { tenantId: TENANT_ID, tenantSlug: TENANT_SLUG };
    req.user = { id: 'seller-case-detail' };
    next();
  });
  app.use('/api/recoveries', recoveryRoutes);
  return app;
}

describe('Case Detail truth contract', () => {
  beforeEach(() => {
    Object.keys(tables).forEach((key) => delete tables[key]);
    tables.dispute_cases = [buildCase()];
    tables.dispute_evidence_links = [];
    tables.evidence_documents = [];
    tables.dispute_submissions = [];
    tables.detection_results = [];
    financialTruthMock.mockReset();
    financialTruthMock.mockResolvedValue({ summaries: [financialSummary()], eventsByInputId: {} });
  });

  it('CD-PAYMENT-RECORDED-UNVERIFIED: stored payout remains recorded and unverified, with the unpaid balance and variance visible', async () => {
    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      approved_amount: 100,
      recorded_payout_amount: 100,
      verified_paid_amount: 0,
      payout_proof_status: 'recorded_unverified',
      financial_payout_status: 'not_paid',
      outstanding_amount: 100,
      variance_amount: -100,
      next_step_context: expect.objectContaining({
        key: 'recorded_payout_unverified',
      }),
    });
  });

  it('CD-PAYMENT-PARTIAL: canonical USD 60 payment against USD 100 approval remains partial with USD 40 outstanding', async () => {
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({
        verified_paid_amount: 60,
        outstanding_amount: 40,
        variance_amount: -40,
        payout_status: 'partially_paid',
        financial_event_count: 1,
        reimbursement_event_count: 1,
        proof_of_payment: {
          amount: 60,
          currency: 'USD',
          event_date: '2026-08-21T10:00:00.000Z',
          reference_id: 'ORDER-DETAIL-1',
          settlement_id: 'SETTLEMENT-DETAIL-60',
          payout_batch_id: null,
          source: 'manual',
        },
      })],
      eventsByInputId: {},
    });

    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      approved_amount: 100,
      recorded_payout_amount: 100,
      verified_paid_amount: 60,
      payout_proof_status: 'verified',
      financial_payout_status: 'partially_paid',
      outstanding_amount: 40,
      variance_amount: -40,
      next_step_context: expect.objectContaining({
        key: 'partial_payout_review',
      }),
    });
  });

  it('CD-PAYMENT-FULL: matching canonical USD 100 reimbursement is financially settled while pending billing remains the distinct next operational step', async () => {
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({
        verified_paid_amount: 100,
        outstanding_amount: 0,
        variance_amount: 0,
        payout_status: 'paid',
        financial_event_count: 1,
        reimbursement_event_count: 1,
        proof_of_payment: {
          amount: 100,
          currency: 'USD',
          event_date: '2026-08-21T10:00:00.000Z',
          reference_id: 'ORDER-DETAIL-1',
          settlement_id: 'SETTLEMENT-DETAIL-100',
          payout_batch_id: null,
          source: 'manual',
        },
      })],
      eventsByInputId: {},
    });

    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      approved_amount: 100,
      recorded_payout_amount: 100,
      verified_paid_amount: 100,
      payout_proof_status: 'verified',
      financial_payout_status: 'paid',
      outstanding_amount: 0,
      variance_amount: 0,
      next_step_context: expect.objectContaining({
        key: 'billing_pending',
      }),
    });
  });

  it('CD-MONEY-UNKNOWN: absent request, estimate, approval, and payout remain unavailable rather than becoming zero or a fabricated fallback amount', async () => {
    tables.dispute_cases = [buildCase({
      claim_amount: null,
      estimated_recovery_amount: null,
      estimated_value: null,
      approved_amount: null,
      recovered_amount: null,
      actual_payout_amount: null,
      status: 'open',
      case_state: 'pending',
      recovery_status: null,
    })];
    financialTruthMock.mockResolvedValue({ summaries: [financialSummary({
      requested_amount: null,
      approved_amount: null,
      verified_paid_amount: 0,
      outstanding_amount: null,
      variance_amount: null,
      payout_status: 'not_paid',
    })], eventsByInputId: {} });

    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requested_amount: null,
      estimated_claim_value: null,
      approved_amount: null,
      recorded_payout_amount: null,
      verified_paid_amount: 0,
      outstanding_amount: null,
      variance_amount: null,
    });
  });

  it('CD-IDENTITY-AND-QUANTITY: observed FNSKU is preserved while a quantity derived from evidence remains derived, not verified source quantity', async () => {
    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fnsku: 'FNSKU-DETAIL-1',
      evidence: expect.objectContaining({ fnsku: 'FNSKU-DETAIL-1' }),
      units_lost: 3,
      units_is_verified: false,
      unit_quantity_source: 'derived_evidence_quantity',
    });
  });
});
