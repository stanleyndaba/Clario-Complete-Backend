import { describe, expect, it } from '@jest/globals';
import {
  buildControlStatement,
  classifyCommercialDecision,
  compareAuditPeriods,
  deriveFirstUsefulResult,
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

  it('routes zero reviewed records to evidence remediation rather than a no-sale conclusion', () => {
    const decision = classifyCommercialDecision({
      currentAudit: { id: 'audit-zero', user_id: 'user-1', tenant_id: 'tenant-1', completed_at: '2026-08-01T00:00:00.000Z' },
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

    expect(decision.commercial_state).toBe('R0-D');
    expect(decision.commercial_route).toBe('EVIDENCE_REMEDIATION');
    expect(decision.commercial_eligibility).toBe('recheck_later');
  });

  it('routes potential findings without enough evidence-ready scope to Nurture manual review', () => {
    const decision = classifyCommercialDecision({
      currentAudit: { id: 'audit-nurture', user_id: 'user-1', tenant_id: 'tenant-1', completed_at: '2026-08-01T00:00:00.000Z' },
      currentSummary: {
        scopeValue: 0,
        findingsCount: 2,
        evidenceReadyCount: 0,
        recordsReviewed: 34,
        categories: ['Inbound shortage'],
        sourcesReviewed: ['Shipments'],
        sourcesUnavailable: [],
      },
      previousAudit: null,
      hasRecoveryWorkspace: false,
    });

    expect(decision.commercial_state).toBe('R0-C');
    expect(decision.commercial_route).toBe('NURTURE');
    expect(decision.commercial_eligibility).toBe('manual_review');
    expect(decision.commercial_reason).toContain('not yet strong enough');
  });

  it('routes an otherwise clean audit with unavailable sources to Nurture recheck later', () => {
    const decision = classifyCommercialDecision({
      currentAudit: { id: 'audit-limited', user_id: 'user-1', tenant_id: 'tenant-1', completed_at: '2026-08-01T00:00:00.000Z' },
      currentSummary: {
        scopeValue: 0,
        findingsCount: 0,
        evidenceReadyCount: 0,
        recordsReviewed: 34,
        categories: [],
        sourcesReviewed: ['Orders'],
        sourcesUnavailable: ['Settlements'],
      },
      previousAudit: null,
      hasRecoveryWorkspace: false,
    });

    expect(decision.commercial_state).toBe('R0-C');
    expect(decision.commercial_route).toBe('NURTURE');
    expect(decision.commercial_eligibility).toBe('recheck_later');
  });

  it('keeps a prior recovery scope that has resolved in the current audit out of paid routing', () => {
    const decision = classifyCommercialDecision({
      currentAudit: { id: 'audit-resolved', user_id: 'user-1', tenant_id: 'tenant-1', completed_at: '2026-08-01T00:00:00.000Z' },
      currentSummary: {
        scopeValue: 0,
        findingsCount: 0,
        evidenceReadyCount: 0,
        recordsReviewed: 50,
        categories: [],
        sourcesReviewed: ['Orders'],
        sourcesUnavailable: [],
      },
      previousAudit: {
        id: 'audit-prior',
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        completed_at: '2026-07-01T00:00:00.000Z',
        summary: {
          scopeValue: 500,
          findingsCount: 1,
          evidenceReadyCount: 1,
          recordsReviewed: 50,
          categories: ['Refund mismatch'],
          sourcesReviewed: ['Orders'],
          sourcesUnavailable: [],
        },
      },
      hasRecoveryWorkspace: false,
    });

    expect(decision.commercial_state).toBe('R0-B');
    expect(decision.commercial_route).toBe('NO_SALE');
    expect(decision.commercial_eligibility).toBe('ineligible');
    expect(decision.commercial_reason).toContain('Prior findings are no longer present');
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
    expect(decision.commercial_route).toBe('WORKSPACE');
    expect(decision.commercial_eligibility).toBe('eligible');
    expect(decision.commercial_reason).toContain('active Recovery Workspace');
  });

  it('keeps a large one-time recovery in Recover Once rather than inferring Talk to Sales', () => {
    const decision = classifyCommercialDecision({
      currentAudit: { id: 'audit-large-once', user_id: 'user-1', tenant_id: 'tenant-1', completed_at: '2026-08-01T00:00:00.000Z' },
      currentSummary: {
        scopeValue: 80000,
        findingsCount: 8,
        evidenceReadyCount: 8,
        recordsReviewed: 120,
        categories: ['Inbound shortage', 'Fee discrepancy'],
        sourcesReviewed: ['Orders', 'Shipments', 'Settlements'],
        sourcesUnavailable: [],
      },
      previousAudit: null,
      hasRecoveryWorkspace: false,
    });

    expect(decision.commercial_route).toBe('RECOVER_ONCE');
    expect(decision.commercial_eligibility).toBe('eligible');
  });

  it('routes recurring high-burden evidence to Talk to Sales with the score basis', () => {
    const previousAudit = {
      id: 'audit-recurring-prev',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      completed_at: '2026-07-01T00:00:00.000Z',
      summary: {
        scopeValue: 4000,
        findingsCount: 2,
        evidenceReadyCount: 1,
        recordsReviewed: 40,
        categories: ['Settlement discrepancy'],
        sourcesReviewed: ['Settlements'],
        sourcesUnavailable: [],
      },
    };
    const currentSummary = {
      scopeValue: 7000,
      findingsCount: 3,
      evidenceReadyCount: 2,
      recordsReviewed: 60,
      categories: ['Settlement discrepancy', 'Refund mismatch', 'Inbound shortage'],
      sourcesReviewed: ['Settlements', 'Returns'],
      sourcesUnavailable: ['Shipments'],
    };

    const decision = classifyCommercialDecision({
      currentAudit: { id: 'audit-recurring-current', user_id: 'user-1', tenant_id: 'tenant-1', completed_at: '2026-08-01T00:00:00.000Z' },
      currentSummary,
      previousAudit,
      hasRecoveryWorkspace: false,
    });

    expect(decision.commercial_route).toBe('TALK_TO_SALES');
    expect(decision.commercial_eligibility).toBe('manual_review');
    expect(decision.commercial_reason).toContain('multi_family');
  });

  it('recommends Workspace for a first-time seller with established recurring burden', () => {
    const previous = {
      id: 'audit-recurring-prev', user_id: 'user-1', tenant_id: 'tenant-1',
      summary: { scopeValue: 4000, findingsCount: 1, evidenceReadyCount: 0, recordsReviewed: 40, categories: ['Refund mismatch'] },
    };
    const current = {
      id: 'audit-recurring-current', user_id: 'user-1', tenant_id: 'tenant-1',
      summary: { scopeValue: 5000, findingsCount: 3, evidenceReadyCount: 2, recordsReviewed: 50, categories: ['Refund mismatch'] },
    };
    const decision = classifyCommercialDecision({ currentAudit: current, currentSummary: current.summary, previousAudit: previous, hasRecoveryWorkspace: false });
    expect(decision.commercial_state).toBe('WORKSPACE');
    expect(decision.commercial_route).toBe('WORKSPACE');
    expect(decision.commercial_eligibility).toBe('eligible');
    expect(decision.commercial_evidence_basis.workspace_recommendation).toBe(true);
    expect(decision.commercial_evidence_basis.sales_review_required).toBe(false);
  });

  it('routes a first-time multi-family recovery to Talk to Sales, not Workspace', () => {
    const previous = {
      id: 'audit-complex-prev', user_id: 'user-1', tenant_id: 'tenant-1',
      summary: { scopeValue: 4000, findingsCount: 1, evidenceReadyCount: 0, recordsReviewed: 40, categories: ['Refund mismatch'] },
    };
    const current = {
      id: 'audit-complex-current', user_id: 'user-1', tenant_id: 'tenant-1',
      summary: { scopeValue: 9000, findingsCount: 3, evidenceReadyCount: 2, recordsReviewed: 60, categories: ['Refund mismatch', 'Inbound shortage', 'Fee overcharge'] },
    };
    const decision = classifyCommercialDecision({ currentAudit: current, currentSummary: current.summary, previousAudit: previous, hasRecoveryWorkspace: false });
    expect(decision.commercial_state).toBe('TALK_TO_SALES');
    expect(decision.commercial_route).toBe('TALK_TO_SALES');
    expect(decision.commercial_eligibility).toBe('manual_review');
    expect(decision.commercial_evidence_basis.workspace_recommendation).toBe(false);
    expect(decision.commercial_evidence_basis.sales_review_required).toBe(true);
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

  it('derives a first useful result from verified recovery truth', () => {
    const result = deriveFirstUsefulResult({
      scopeValue: 4200,
      findingsCount: 2,
      evidenceReadyCount: 1,
      recordsReviewed: 180,
      categories: ['Inbound shortage'],
      sourcesReviewed: ['Shipments', 'Settlements'],
      sourcesUnavailable: [],
      finalStatus: 'complete_with_findings',
    });

    expect(result.milestone).toBe('FIRST_USEFUL_RESULT');
    expect(result.kind).toBe('verified_recovery');
    expect(result.evidence_basis.scope_value).toBe(4200);
    expect(result.evidence_basis.findings_count).toBe(2);
  });

  it('derives a first useful result from a material data limitation', () => {
    const result = deriveFirstUsefulResult({
      scopeValue: 0,
      findingsCount: 0,
      evidenceReadyCount: 0,
      recordsReviewed: 0,
      categories: [],
      sourcesReviewed: [],
      sourcesUnavailable: ['Shipments'],
      finalStatus: 'partial_no_findings',
    });

    expect(result.milestone).toBe('FIRST_USEFUL_RESULT');
    expect(result.kind).toBe('material_data_limitation');
    expect(result.evidence_basis.records_reviewed).toBe(0);
    expect(result.evidence_basis.sources_unavailable).toContain('Shipments');
  });
});
