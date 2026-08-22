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
const canonicalEvidenceTruthMock = jest.fn<any>();

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
      or: () => builder,
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
  evaluateCanonicalEvidenceTruth: (...args: any[]) => canonicalEvidenceTruthMock(...args),
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
jest.mock('../../src/middleware/authMiddleware', () => ({
  authenticateToken: (_req: any, _res: any, next: () => void) => next(),
}));
jest.mock('../../src/utils/tokenManager', () => ({
  __esModule: true,
  default: { getToken: jest.fn(async () => 'controlled-accounting-token') },
}));

import recoveryRoutes from '../../src/routes/recoveryRoutes';
import reconciliationRoutes from '../../src/routes/reconciliationRoutes';

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
      verified_paid_amount: null,
      outstanding_amount: null,
      variance_amount: null,
      payout_status: 'unavailable',
      reversal_state: 'unavailable',
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
    req.tenantId = TENANT_ID;
    req.user = { id: 'seller-case-detail' };
    req.userId = 'seller-case-detail';
    next();
  });
  app.use('/api/recoveries', recoveryRoutes);
  return app;
}

function createReconciliationApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.tenant = { tenantId: TENANT_ID, tenantSlug: TENANT_SLUG };
    req.tenantId = TENANT_ID;
    req.user = { id: 'seller-case-detail' };
    req.userId = 'seller-case-detail';
    next();
  });
  app.use('/api/recoveries', reconciliationRoutes);
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
    tables.financial_events = [];
    tables.recovery_reconciliations = [];
    tables.evidence_sources = [];
    financialTruthMock.mockReset();
    canonicalEvidenceTruthMock.mockReset();
    canonicalEvidenceTruthMock.mockReturnValue({
      linkedDocumentCount: 0,
      isEvidenceComplete: false,
      requiredRequirements: [],
      missingRequirements: ['proof_snapshot'],
    });
    financialTruthMock.mockResolvedValue({ summaries: [financialSummary()], eventsByInputId: {} });
  });

  it('CD-PAYMENT-RECORDED-UNVERIFIED: stored payout remains recorded and unverified, with the unpaid balance and variance visible', async () => {
    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      approved_amount: 100,
      recorded_payout_amount: 100,
        verified_paid_amount: null,
        payout_proof_status: 'recorded_unverified',
        financial_payout_status: 'unavailable',
        outstanding_amount: null,
        variance_amount: null,
        next_step_context: expect.objectContaining({
          key: 'recorded_payout_unverified',
        }),
        closure_truth: expect.objectContaining({
          financially_closed: false,
          state: 'pending_payment',
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
        reversal_state: 'none_observed',
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
        reversal_state: 'none_observed',
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
        key: 'verified_payout_accounting_review',
      }),
      accounting_truth: expect.objectContaining({
        status: 'not_connected',
      }),
      closure_truth: expect.objectContaining({
        financially_closed: false,
        state: 'accounting_review',
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
      verified_paid_amount: null,
      outstanding_amount: null,
      variance_amount: null,
      payout_status: 'unavailable',
      reversal_state: 'unavailable',
    })], eventsByInputId: {} });

    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requested_amount: null,
      estimated_claim_value: null,
      approved_amount: null,
      recorded_payout_amount: null,
      verified_paid_amount: null,
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
      unit_quantity_source: 'derived',
      unit_value_provenance: 'derived',
    });
  });

  it('RTR-10: a reimbursement reversal cannot remain paid or financially closed', async () => {
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({
        verified_paid_amount: 0,
        outstanding_amount: 100,
        variance_amount: -100,
        payout_status: 'reversed',
        reversal_state: 'reversed',
        financial_event_count: 2,
        reimbursement_event_count: 1,
        proof_of_payment: {
          amount: 100,
          currency: 'USD',
          event_date: '2026-08-21T11:00:00.000Z',
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
      verified_paid_amount: 0,
      financial_payout_status: 'reversed',
      financial_reversal_state: 'reversed',
      next_step_context: expect.objectContaining({ key: 'reversal_review' }),
      closure_truth: expect.objectContaining({
        financially_closed: false,
        state: 'reversal_review',
      }),
    });
  });

  it('RTR-09: financially closed requires verified payment, a zero established balance, and an explicit reconciled accounting disposition', async () => {
    tables.recovery_reconciliations = [{
      tenant_id: TENANT_ID,
      recovery_id: CASE_ID,
      provider: 'quickbooks',
      status: 'RECONCILED',
      matched_amount: 100,
      difference: 0,
      reconciled_at: '2026-08-22T09:00:00.000Z',
    }];
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({
        verified_paid_amount: 100,
        outstanding_amount: 0,
        variance_amount: 0,
        payout_status: 'paid',
        reversal_state: 'none_observed',
      })],
      eventsByInputId: {},
    });

    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accounting_truth: expect.objectContaining({
        status: 'reconciled',
        provider: 'quickbooks',
        reconciled_at: '2026-08-22T09:00:00.000Z',
      }),
      closure_truth: expect.objectContaining({
        financially_closed: true,
        state: 'financially_closed',
        closed_at: '2026-08-22T09:00:00.000Z',
      }),
    });
  });

  it('RTR-12: absent safety fields remain not assessed rather than silently becoming negative conclusions', async () => {
    const response = await request(createApp())
      .get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      prior_reimbursement_detected: null,
      inventory_adjustment_applied: null,
      duplicate_blocked: null,
      safety_evaluations: {
        prior_reimbursement: expect.objectContaining({ state: 'not_assessed' }),
        inventory_adjustment: expect.objectContaining({ state: 'not_assessed' }),
        duplicate_claim: expect.objectContaining({ state: 'not_assessed' }),
      },
    });
  });

  it('RTR-10-SERVICE: a matched reimbursement reversal is evaluated as reversed by the canonical financial truth service', async () => {
    tables.financial_events = [
      {
        id: 'payment-100', tenant_id: TENANT_ID, seller_id: 'seller-case-detail', store_id: 'store-case-detail',
        event_type: 'reimbursement', event_subtype: 'fba_inventory_reimbursement', amount: 100, currency: 'USD',
        event_date: '2026-08-21T10:00:00.000Z', amazon_order_id: 'ORDER-DETAIL-1', reference_id: 'ORDER-DETAIL-1',
        settlement_id: 'SETTLEMENT-DETAIL-100', payout_batch_id: null, amazon_event_id: 'payment-100', source: 'manual', raw_payload: {},
      },
      {
        id: 'reversal-100', tenant_id: TENANT_ID, seller_id: 'seller-case-detail', store_id: 'store-case-detail',
        event_type: 'reimbursement', event_subtype: 'reimbursement_reversal', amount: -100, currency: 'USD',
        event_date: '2026-08-22T10:00:00.000Z', amazon_order_id: 'ORDER-DETAIL-1', reference_id: 'ORDER-DETAIL-1',
        settlement_id: 'SETTLEMENT-DETAIL-100', payout_batch_id: null, amazon_event_id: 'reversal-100', source: 'manual', raw_payload: {},
      },
    ];
    const actualModule = jest.requireActual('../../src/services/recoveryFinancialTruthService') as typeof import('../../src/services/recoveryFinancialTruthService');
    const result = await actualModule.recoveryFinancialTruthService.getFinancialTruth({
      tenantId: TENANT_ID,
      caseIds: [CASE_ID],
      storeId: 'store-case-detail',
    });

    expect(result.summaries[0]).toMatchObject({
      verified_paid_amount: 0,
      outstanding_amount: 100,
      payout_status: 'not_paid',
      reversal_state: 'reversed',
    });
  });

  it('RTR-RECONCILIATION-MISSING-AMOUNT: reconciliation is blocked without persisting or inventing an expected amount', async () => {
    tables.dispute_cases = [buildCase({ claim_amount: null, amount: null })];

    const response = await request(createReconciliationApp())
      .post(`/api/recoveries/${CASE_ID}/reconcile?provider=quickbooks`);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      success: false,
      error: 'expected_amount_unavailable',
      data: expect.objectContaining({
        expected_amount: null,
        reconciliation_status: 'unavailable',
      }),
    });
    expect(JSON.stringify(response.body)).not.toContain('842.17');
    expect(tables.recovery_reconciliations).toHaveLength(0);
  });

  it('A1-CLOSURE-1: billing completion without accounting reconciliation remains accounting review and not closed', async () => {
    tables.dispute_cases = [buildCase({ billing_status: 'paid' })];
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({ verified_paid_amount: 100, outstanding_amount: 0, variance_amount: 0, payout_status: 'paid', reversal_state: 'none_observed' })],
      eventsByInputId: {},
    });

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      billing_status: 'paid',
      closure_truth: expect.objectContaining({ financially_closed: false, state: 'accounting_review' }),
    });
  });

  it('A1-CLOSURE-2: reconciled accounting cannot override an unresolved reversal relationship', async () => {
    tables.recovery_reconciliations = [{ tenant_id: TENANT_ID, recovery_id: CASE_ID, provider: 'xero', status: 'RECONCILED', matched_amount: 100, difference: 0, reconciled_at: '2026-08-22T09:00:00.000Z' }];
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({ verified_paid_amount: 100, outstanding_amount: 0, variance_amount: 0, payout_status: 'paid', reversal_state: 'review_required' })],
      eventsByInputId: {},
    });

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      financial_payout_status: 'reversal_review',
      closure_truth: expect.objectContaining({ financially_closed: false, state: 'reversal_review' }),
    });
  });

  it('A1-CLOSURE-3: unmatched accounting cannot close a fully paid zero-outstanding recovery', async () => {
    tables.recovery_reconciliations = [{ tenant_id: TENANT_ID, recovery_id: CASE_ID, provider: 'quickbooks', status: 'UNMATCHED', matched_amount: null, difference: null, reconciled_at: null }];
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({ verified_paid_amount: 100, outstanding_amount: 0, variance_amount: 0, payout_status: 'paid', reversal_state: 'none_observed' })],
      eventsByInputId: {},
    });

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accounting_truth: expect.objectContaining({ status: 'unmatched' }),
      closure_truth: expect.objectContaining({ financially_closed: false, state: 'accounting_review' }),
    });
  });

  it('A1-CLOSURE-4: reconciled accounting cannot erase an established partial payment', async () => {
    tables.recovery_reconciliations = [{ tenant_id: TENANT_ID, recovery_id: CASE_ID, provider: 'quickbooks', status: 'RECONCILED', matched_amount: 60, difference: -40, reconciled_at: '2026-08-22T09:00:00.000Z' }];
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({ verified_paid_amount: 60, outstanding_amount: 40, variance_amount: -40, payout_status: 'partially_paid', reversal_state: 'none_observed' })],
      eventsByInputId: {},
    });

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      closure_truth: expect.objectContaining({ financially_closed: false, state: 'partial_payment' }),
      next_step_context: expect.objectContaining({ key: 'partial_payout_review' }),
    });
  });

  it('A1-CLOSURE-5: reconciled accounting cannot resurrect a conclusively reversed recovery', async () => {
    tables.recovery_reconciliations = [{ tenant_id: TENANT_ID, recovery_id: CASE_ID, provider: 'quickbooks', status: 'RECONCILED', matched_amount: 100, difference: 0, reconciled_at: '2026-08-22T09:00:00.000Z' }];
    financialTruthMock.mockResolvedValue({
      summaries: [financialSummary({ verified_paid_amount: 0, outstanding_amount: 100, variance_amount: -100, payout_status: 'not_paid', reversal_state: 'reversed' })],
      eventsByInputId: {},
    });

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      financial_reversal_state: 'reversed',
      closure_truth: expect.objectContaining({ financially_closed: false, state: 'reversal_review' }),
    });
  });

  it('RTR-01: an unfiled detection without a case remains detection truth and not filed', async () => {
    tables.dispute_cases = [];
    tables.detection_results = [{
      id: CASE_ID, tenant_id: TENANT_ID, seller_id: 'seller-case-detail', store_id: 'store-case-detail',
      status: 'open', filing_status: null, estimated_value: 100, currency: 'USD', sku: 'SKU-DETECTION-1',
      evidence: {}, created_at: '2026-08-20T10:00:00.000Z', updated_at: '2026-08-20T10:00:00.000Z',
    }];

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      entity_type: 'detection',
      has_linked_dispute_case: false,
      has_filing_truth: false,
      next_step_context: expect.objectContaining({ key: 'waiting_for_evidence' }),
    });
  });

  it('RTR-02: incomplete evidence exposes missing requirements and a responsible evidence action', async () => {
    tables.dispute_cases = [buildCase({ status: 'open', case_state: 'pending', filing_status: 'pending', approved_amount: null, recovered_amount: null })];
    canonicalEvidenceTruthMock.mockReturnValue({ linkedDocumentCount: 0, isEvidenceComplete: false, requiredRequirements: ['invoice'], missingRequirements: ['invoice'] });

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      evidence_summary: expect.objectContaining({ evidence_complete: false, missing_requirements: ['invoice'] }),
      next_step_context: expect.objectContaining({ key: 'waiting_for_linked_evidence', generated: false }),
    });
  });

  it('RTR-03: linked evidence on a detection is supportable but does not imply filing or create a case', async () => {
    tables.dispute_cases = [];
    tables.detection_results = [{ id: CASE_ID, tenant_id: TENANT_ID, seller_id: 'seller-case-detail', store_id: 'store-case-detail', status: 'open', estimated_value: 100, currency: 'USD', matched_document_ids: ['DOC-RTR-03'], evidence: {}, created_at: '2026-08-20T10:00:00.000Z' }];
    tables.evidence_documents = [{ id: 'DOC-RTR-03', tenant_id: TENANT_ID, filename: 'supporting-invoice.pdf', doc_type: 'invoice', created_at: '2026-08-20T10:00:00.000Z' }];
    canonicalEvidenceTruthMock.mockReturnValue({ linkedDocumentCount: 1, isEvidenceComplete: true, requiredRequirements: ['invoice'], missingRequirements: [] });

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      entity_type: 'detection',
      has_linked_dispute_case: false,
      has_filing_truth: false,
      next_step_context: expect.objectContaining({ key: 'supportable_not_case_eligible', generated: false }),
    });
  });

  it('RTR-04: a filed case exposes a durable recorded submission reference and timestamp', async () => {
    tables.dispute_submissions = [{
      id: 'SUBMISSION-1', tenant_id: TENANT_ID, dispute_id: CASE_ID, submission_id: 'AMAZON-SUBMISSION-1',
      amazon_case_id: 'AMAZON-CASE-DETAIL-1', external_reference: 'EXTERNAL-REF-1',
      submission_timestamp: '2026-08-21T08:00:00.000Z', request_started_at: '2026-08-21T07:59:00.000Z',
      response_received_at: '2026-08-21T08:01:00.000Z', submission_channel: 'sp_api', status: 'submitted',
      outcome: null, created_at: '2026-08-21T08:00:00.000Z', updated_at: '2026-08-21T08:01:00.000Z',
    }];

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      has_submission: true,
      has_submission_proof: true,
      has_filing_truth: true,
      submission_proof: expect.objectContaining({
        submission_id: 'AMAZON-SUBMISSION-1',
        proof_reference: 'EXTERNAL-REF-1',
        submitted_at: '2026-08-21T08:00:00.000Z',
      }),
    });
  });

  it('RTR-14-MISSING: missing FNSKU remains unavailable and is not rendered as a negative identity assertion', async () => {
    tables.dispute_cases = [buildCase({ fnsku: null, evidence: { quantity: 3 } })];

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fnsku: null,
      evidence: expect.objectContaining({ fnsku: null }),
      identity_truth: expect.objectContaining({
        fnsku: expect.objectContaining({ state: 'unavailable', relationship_strength: 'unavailable' }),
      }),
    });
  });

  it('RTR-16: generated context remains explicitly generated and cannot become evidence, payment, or closure proof', async () => {
    tables.dispute_cases = [buildCase({ status: 'open', filing_status: 'pending', approved_amount: null, recovered_amount: null, evidence_attachments: {} })];

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      generated_context: expect.objectContaining({ generated: true }),
      evidence_summary: expect.objectContaining({ has_documents: false }),
      verified_paid_amount: null,
      closure_truth: expect.objectContaining({ financially_closed: false }),
    });
  });

  it('RTR-17: fallback history events retain a case-record source instead of claiming a notification or agent-event source', async () => {
    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}/events?tenantSlug=${TENANT_SLUG}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.every((event: any) => event.source === 'case_record')).toBe(true);
  });

  it('RTR-14-CONFLICT: contradictory observed FNSKUs remain explicit identity conflict, never a silently matched identity', async () => {
    tables.dispute_cases = [buildCase({ fnsku: 'FNSKU-CASE-1', evidence: { quantity: 3, fnsku: 'FNSKU-EVIDENCE-2' } })];

    const response = await request(createApp()).get(`/api/recoveries/${CASE_ID}?tenantSlug=${TENANT_SLUG}&includeEvents=false`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fnsku: 'FNSKU-CASE-1',
      identity_truth: expect.objectContaining({
        fnsku: expect.objectContaining({ state: 'conflicted' }),
      }),
    });
  });
});
