import { describe, expect, it } from '@jest/globals';
import { calculateRecoverOnceQuote } from '../src/services/recoverOnceService';
import { classifyCommercialDecision } from '../src/services/auditCommercialDecisionService';

const audit = (id: string, summary: Record<string, unknown>) => ({ id, user_id: 'u', tenant_id: 't', completed_at: '2026-08-01T00:00:00.000Z', summary });
const summary = (scopeValue: number, findingsCount: number, evidenceReadyCount: number, recordsReviewed = 100) => ({ scopeValue, findingsCount, evidenceReadyCount, recordsReviewed, categories: ['Inbound shortage'], sourcesReviewed: ['Orders'], sourcesUnavailable: [] });

describe('forensic Audit Results to commercial boundary', () => {
  it.each([5000, 25000, 100000, 500000])('does not route one-time value %s to recurring control without a previous audit', (value) => {
    const current = summary(value, 1, 1);
    const decision = classifyCommercialDecision({ currentAudit: audit(`once-${value}`, current), currentSummary: current, previousAudit: null, hasRecoveryWorkspace: false });
    expect(decision.comparison.recurring_burden).toBe(false);
    expect(decision.commercial_route).not.toBe('RECOVERY_CONTROL');
  });

  it('keeps a large one-time opportunity in a scope-driven Recover Once tier', () => {
    expect(calculateRecoverOnceQuote({ opportunityCount: 1, workloadScore: 1, estimatedRecoverableSubunits: 7_500_000 })).toMatchObject({ status: 'available', amountSubunits: 149900, tier: 'light' });
    expect(calculateRecoverOnceQuote({ opportunityCount: 3, workloadScore: 6, estimatedRecoverableSubunits: 7_500_000 })).toMatchObject({ status: 'available', amountSubunits: 499900, tier: 'complex' });
  });

  it('does not force a scope beyond the automatic quote guardrail into the top visible tier', () => {
    expect(calculateRecoverOnceQuote({ opportunityCount: 10, workloadScore: 10, estimatedRecoverableSubunits: 7_500_000 })).toMatchObject({ status: 'manual_review_required', amountSubunits: null });
  });

  it('requires previous-period evidence before recurring high burden can route to Talk to Sales', () => {
    const previous = audit('previous', summary(4000, 2, 1, 40));
    const current = summary(7000, 3, 2, 60);
    const decision = classifyCommercialDecision({ currentAudit: audit('current', current), currentSummary: current, previousAudit: previous, hasRecoveryWorkspace: false });
    expect(decision.comparison.recurring_burden).toBe(true);
    expect(decision.comparison.operational_burden_score).toBe(18);
    expect(decision.commercial_route).toBe('WORKSPACE');
    expect(decision.commercial_eligibility).toBe('eligible');
    expect(decision.commercial_evidence_basis.workspace_recommendation).toBe(true);
  });

  it('does not call a previous audit with no current findings recurring high burden', () => {
    const previous = audit('previous', summary(4000, 2, 1, 40));
    const current = summary(0, 0, 0, 60);
    const decision = classifyCommercialDecision({ currentAudit: audit('current', current), currentSummary: current, previousAudit: previous, hasRecoveryWorkspace: false });
    expect(decision.comparison.recurring_burden).toBe(false);
    expect(decision.commercial_route).not.toBe('RECOVERY_CONTROL');
  });

  it('routes a multi-family recurring profile to Talk to Sales', () => {
    const previous = audit('previous', summary(4000, 2, 1, 40));
    const current = summary(7000, 3, 2, 60);
    current.categories = ['Inbound shortage', 'Fee discrepancy', 'Transfer loss'];
    const decision = classifyCommercialDecision({ currentAudit: audit('current', current), currentSummary: current, previousAudit: previous, hasRecoveryWorkspace: false });
    expect(decision.commercial_route).toBe('TALK_TO_SALES');
    expect(decision.commercial_eligibility).toBe('manual_review');
    expect(decision.commercial_evidence_basis.sales_review_required).toBe(true);
  });

  it('uses existing Workspace entitlement without routing it to Talk-to-Sales', () => {
    const current = summary(1000, 1, 1, 20);
    const decision = classifyCommercialDecision({ currentAudit: audit('workspace', current), currentSummary: current, previousAudit: null, hasRecoveryWorkspace: true });
    expect(decision.commercial_route).toBe('WORKSPACE');
    expect(decision.commercial_reason).toContain('active Recovery Workspace');
  });
});
