import { describe, expect, it } from '@jest/globals';
import {
  buildControlStatement,
  classifyCommercialDecision,
  compareAuditPeriods,
} from '../../src/services/auditCommercialDecisionService';

describe('auditCommercialDecisionService', () => {
  it('classifies a clean audit with no prior scope as no sale', () => {
    const decision = classifyCommercialDecision({
      currentAudit: {
        id: 'audit-1',
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        completed_at: '2026-08-01T00:00:00.000Z',
        summary: {
          scopeValue: 0,
          findingsCount: 0,
          evidenceReadyCount: 0,
          recordsReviewed: 120,
          categories: [],
          sourcesReviewed: ['Orders'],
          sourcesUnavailable: [],
        },
      },
      currentSummary: {
        scopeValue: 0,
        findingsCount: 0,
        evidenceReadyCount: 0,
        recordsReviewed: 120,
        categories: [],
        sourcesReviewed: ['Orders'],
        sourcesUnavailable: [],
      },
      previousAudit: null,
      hasRecoveryWorkspace: false,
    });

    expect(decision.commercial_state).toBe('R0-A');
    expect(decision.commercial_route).toBe('NO_SALE');
    expect(decision.commercial_eligibility).toBe('ineligible');
  });

  it('classifies a verified recovery as Recover Once', () => {
    const decision = classifyCommercialDecision({
      currentAudit: {
        id: 'audit-2',
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        completed_at: '2026-08-01T00:00:00.000Z',
        summary: {
          scopeValue: 12500,
          findingsCount: 2,
          evidenceReadyCount: 2,
          recordsReviewed: 80,
          categories: ['Inbound shortage', 'Fee overcharge'],
          sourcesReviewed: ['Orders', 'Shipments'],
          sourcesUnavailable: [],
        },
      },
      currentSummary: {
        scopeValue: 12500,
        findingsCount: 2,
        evidenceReadyCount: 2,
        recordsReviewed: 80,
        categories: ['Inbound shortage', 'Fee overcharge'],
        sourcesReviewed: ['Orders', 'Shipments'],
        sourcesUnavailable: [],
      },
      previousAudit: null,
      hasRecoveryWorkspace: false,
    });

    expect(decision.commercial_state).toBe('VERIFIED_RECOVERY');
    expect(decision.commercial_route).toBe('RECOVER_ONCE');
    expect(decision.commercial_eligibility).toBe('eligible');
  });

  it('routes recurring control burden into Recovery Control', () => {
    const previousAudit = {
      id: 'audit-prev',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      completed_at: '2026-07-01T00:00:00.000Z',
      summary: {
        scopeValue: 5000,
        findingsCount: 1,
        evidenceReadyCount: 0,
        recordsReviewed: 40,
        categories: ['Settlement discrepancy'],
        sourcesReviewed: ['Settlements'],
        sourcesUnavailable: [],
      },
    };

    const current = {
      id: 'audit-current',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      completed_at: '2026-08-01T00:00:00.000Z',
      summary: {
        scopeValue: 6200,
        findingsCount: 2,
        evidenceReadyCount: 1,
        recordsReviewed: 50,
        categories: ['Settlement discrepancy', 'Refund mismatch'],
        sourcesReviewed: ['Settlements', 'Returns'],
        sourcesUnavailable: [],
      },
    };

    const comparison = compareAuditPeriods(previousAudit.summary, current.summary, previousAudit.id, current.id);
    expect(comparison.recurring_burden).toBe(true);

    const decision = classifyCommercialDecision({
      currentAudit: current,
      currentSummary: current.summary,
      previousAudit,
      hasRecoveryWorkspace: true,
    });

    expect(decision.commercial_state).toBe('WORKSPACE');
    expect(decision.commercial_route).toBe('RECOVERY_CONTROL');
    expect(decision.commercial_eligibility).toBe('eligible');
  });

  it('builds a control statement from the decision', () => {
    const decision = classifyCommercialDecision({
      currentAudit: {
        id: 'audit-3',
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        completed_at: '2026-08-01T00:00:00.000Z',
        summary: {
          scopeValue: 0,
          findingsCount: 0,
          evidenceReadyCount: 0,
          recordsReviewed: 0,
          categories: [],
          sourcesReviewed: [],
          sourcesUnavailable: ['Shipments'],
        },
      },
      currentSummary: {
        scopeValue: 0,
        findingsCount: 0,
        evidenceReadyCount: 0,
        recordsReviewed: 0,
        categories: [],
        sourcesReviewed: [],
        sourcesUnavailable: ['Shipments'],
      },
      previousAudit: null,
      hasRecoveryWorkspace: false,
    });

    const statement = buildControlStatement({
      currentAudit: {
        id: 'audit-3',
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        completed_at: '2026-08-01T00:00:00.000Z',
        summary: {
          scopeValue: 0,
          findingsCount: 0,
          evidenceReadyCount: 0,
          recordsReviewed: 0,
          categories: [],
          sourcesReviewed: [],
          sourcesUnavailable: ['Shipments'],
        },
      },
      commercialDecision: decision,
    });

    expect(statement.control_status).toBe('DATA_INCOMPLETE');
    expect(statement.event_population.records_reviewed).toBe(0);
    expect(statement.evidence_gaps).toContain('Shipments');
  });
});
