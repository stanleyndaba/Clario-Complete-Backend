export type CommercialRoute =
  | 'RECOVER_ONCE'
  | 'WORKSPACE'
  | 'RECOVERY_CONTROL'
  | 'EVIDENCE_REMEDIATION'
  | 'PROVIDER_QA'
  | 'NURTURE'
  | 'NO_SALE';

export type CommercialState =
  | 'R0-A'
  | 'R0-B'
  | 'R0-C'
  | 'R0-D'
  | 'R0-E'
  | 'R0-F'
  | 'R0-G'
  | 'R0-H'
  | 'VERIFIED_RECOVERY'
  | 'RECOVER_ONCE'
  | 'WORKSPACE'
  | 'RECOVERY_CONTROL'
  | 'EVIDENCE_REMEDIATION'
  | 'PROVIDER_QA'
  | 'NURTURE'
  | 'NO_SALE';

export type CommercialEligibility = 'eligible' | 'ineligible' | 'recheck_later' | 'manual_review';

export interface AuditSummaryLike {
  scopeValue?: number | null;
  findingsCount?: number | null;
  categories?: string[] | null;
  evidenceReadyCount?: number | null;
  locked?: boolean | null;
  message?: string | null;
  finalStatus?: string | null;
  recordsReviewed?: number | null;
  sourcesReviewed?: string[] | null;
  sourcesUnavailable?: string[] | null;
  retryable?: boolean | null;
}

export interface AuditRecordLike {
  id: string;
  user_id: string;
  tenant_id: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  status?: string | null;
  activation_status?: string | null;
  summary?: AuditSummaryLike | null;
}

export interface CommercialComparison {
  previous_audit_id: string | null;
  current_audit_id: string;
  comparison_available: boolean;
  previous_scope_value: number;
  current_scope_value: number;
  scope_value_delta: number;
  previous_findings_count: number;
  current_findings_count: number;
  findings_delta: number;
  previous_evidence_ready_count: number;
  current_evidence_ready_count: number;
  evidence_ready_delta: number;
  previous_records_reviewed: number;
  current_records_reviewed: number;
  records_reviewed_delta: number;
  new_categories: string[];
  resolved_categories: string[];
  persistent_categories: string[];
  sources_changed: string[];
  unresolved_sources: string[];
  recurring_burden: boolean;
  operational_burden_score: number;
}

export interface CommercialDecision {
  commercial_state: CommercialState;
  commercial_route: CommercialRoute;
  commercial_reason: string;
  commercial_eligibility: CommercialEligibility;
  commercial_evidence_basis: Record<string, unknown>;
  commercial_decided_at: string;
  previous_audit_id: string | null;
  last_audit_at: string | null;
  next_eligible_at: string | null;
  comparison: CommercialComparison;
}

export interface ControlStatement {
  coverage_start: string;
  coverage_end: string;
  generated_at: string;
  data_freshness: 'UNDER_CONTROL' | 'ACTION_REQUIRED' | 'DATA_INCOMPLETE';
  event_population: {
    records_reviewed: number;
    findings_count: number;
    scope_value: number;
    evidence_ready_count: number;
    sources_reviewed: string[];
    sources_unavailable: string[];
  };
  automatic_reimbursements: number;
  manual_reimbursements: number;
  reversals: number;
  exceptions_investigated: number;
  unresolved_recoveries: number;
  evidence_gaps: string[];
  deadlines_approaching: string[];
  open_cases: number;
  control_status: 'UNDER_CONTROL' | 'ACTION_REQUIRED' | 'DATA_INCOMPLETE';
  source_lineage: {
    previous_audit_id: string | null;
    current_audit_id: string;
    comparison_available: boolean;
    recurring_burden: boolean;
  };
  payload: Record<string, unknown>;
}

export type FirstUsefulResultKind =
  | 'verified_recovery'
  | 'material_data_limitation'
  | 'coverage_verified'
  | 'r0_explanation';

export interface FirstUsefulResult {
  milestone: 'FIRST_USEFUL_RESULT';
  kind: FirstUsefulResultKind;
  message: string;
  evidence_basis: {
    scope_value: number;
    findings_count: number;
    evidence_ready_count: number;
    records_reviewed: number;
    categories: string[];
    sources_reviewed: string[];
    sources_unavailable: string[];
    final_status: string;
  };
}

function numberFrom(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCount(value: unknown): number {
  return Math.max(0, Math.floor(numberFrom(value)));
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean)));
}

function normalizeMessage(value: unknown): string {
  return String(value || '').trim();
}

function analyzeAuditSummary(summary?: AuditSummaryLike | null) {
  const safe = summary || {};
  const scopeValue = Math.max(0, numberFrom(safe.scopeValue));
  const findingsCount = toCount(safe.findingsCount);
  const evidenceReadyCount = toCount(safe.evidenceReadyCount);
  const recordsReviewed = toCount(safe.recordsReviewed);
  const sourcesReviewed = normalizeList(safe.sourcesReviewed);
  const sourcesUnavailable = normalizeList(safe.sourcesUnavailable);
  const categories = normalizeList(safe.categories);
  return {
    scopeValue,
    findingsCount,
    evidenceReadyCount,
    recordsReviewed,
    sourcesReviewed,
    sourcesUnavailable,
    categories,
    finalStatus: normalizeMessage(safe.finalStatus),
    message: normalizeMessage(safe.message),
    retryable: Boolean(safe.retryable),
  };
}

export function compareAuditPeriods(previous: AuditSummaryLike | null | undefined, current: AuditSummaryLike | null | undefined, previousAuditId: string | null, currentAuditId: string): CommercialComparison {
  const prev = analyzeAuditSummary(previous);
  const curr = analyzeAuditSummary(current);
  const previousCategories = new Set(prev.categories);
  const currentCategories = new Set(curr.categories);
  const newCategories = curr.categories.filter((category) => !previousCategories.has(category));
  const resolvedCategories = prev.categories.filter((category) => !currentCategories.has(category));
  const persistentCategories = curr.categories.filter((category) => previousCategories.has(category));
  const unresolvedSources = curr.sourcesUnavailable;
  const sourcesChanged = Array.from(new Set([...prev.sourcesReviewed, ...curr.sourcesReviewed, ...prev.sourcesUnavailable, ...curr.sourcesUnavailable]));
  const recurringBurden = curr.findingsCount > 0 && (
    curr.scopeValue > 0 ||
    curr.recordsReviewed > 0 ||
    curr.evidenceReadyCount > 0 ||
    persistentCategories.length > 0 ||
    newCategories.length > 0
  );
  const operationalBurdenScore =
    (curr.findingsCount * 4) +
    (curr.evidenceReadyCount * 2) +
    (curr.recordsReviewed > 0 ? 1 : 0) +
    (curr.sourcesUnavailable.length * 3) +
    persistentCategories.length;

  return {
    previous_audit_id: previousAuditId,
    current_audit_id: currentAuditId,
    comparison_available: Boolean(previous),
    previous_scope_value: prev.scopeValue,
    current_scope_value: curr.scopeValue,
    scope_value_delta: curr.scopeValue - prev.scopeValue,
    previous_findings_count: prev.findingsCount,
    current_findings_count: curr.findingsCount,
    findings_delta: curr.findingsCount - prev.findingsCount,
    previous_evidence_ready_count: prev.evidenceReadyCount,
    current_evidence_ready_count: curr.evidenceReadyCount,
    evidence_ready_delta: curr.evidenceReadyCount - prev.evidenceReadyCount,
    previous_records_reviewed: prev.recordsReviewed,
    current_records_reviewed: curr.recordsReviewed,
    records_reviewed_delta: curr.recordsReviewed - prev.recordsReviewed,
    new_categories: newCategories,
    resolved_categories: resolvedCategories,
    persistent_categories: persistentCategories,
    sources_changed: sourcesChanged,
    unresolved_sources: unresolvedSources,
    recurring_burden: recurringBurden,
    operational_burden_score: operationalBurdenScore,
  };
}

function buildReason(state: CommercialState, route: CommercialRoute, current: ReturnType<typeof analyzeAuditSummary>, comparison: CommercialComparison, hasRecoveryWorkspace: boolean): string {
  const availabilityNote = current.recordsReviewed === 0
    ? 'No usable Amazon records were available for review.'
    : current.sourcesUnavailable.length > 0
      ? `Some Amazon sources were unavailable: ${current.sourcesUnavailable.join(', ')}.`
      : 'Amazon data was available for review.';

  switch (route) {
    case 'RECOVER_ONCE':
      return `${availabilityNote} Margin identified a verified recovery opportunity that can be executed as a one-time engagement.`;
    case 'WORKSPACE':
    case 'RECOVERY_CONTROL':
      return `${availabilityNote} The audit shows recurring recovery/control work that is better handled through continuous monitoring.`;
    case 'EVIDENCE_REMEDIATION':
      return `${availabilityNote} Margin could not fully evaluate the recovery opportunity without additional evidence.`;
    case 'PROVIDER_QA':
      return `${availabilityNote} A provider-related gap or oversight appears likely enough to justify a quality check.`;
    case 'NURTURE':
      return `${availabilityNote} Exposure exists, but it is not yet strong enough to recommend a paid recovery action.`;
    case 'NO_SALE':
    default:
      if (comparison.previous_findings_count > 0 && current.findingsCount === 0) {
        return `${availabilityNote} Prior findings are no longer present, so no paid action is needed right now.`;
      }
      if (hasRecoveryWorkspace && current.findingsCount === 0 && current.recordsReviewed > 0) {
        return `${availabilityNote} The workspace is active, but this audit did not produce a new commercial action.`;
      }
      return `${availabilityNote} Margin did not identify a paid recovery route from the audit truth available today.`;
  }
}

export function classifyCommercialDecision(input: {
  currentAudit: AuditRecordLike;
  currentSummary: AuditSummaryLike | null | undefined;
  previousAudit?: AuditRecordLike | null | undefined;
  hasRecoveryWorkspace?: boolean;
}): CommercialDecision {
  const current = analyzeAuditSummary(input.currentSummary);
  const previous = input.previousAudit ? analyzeAuditSummary(input.previousAudit.summary || null) : null;
  const comparison = compareAuditPeriods(previous, current, input.previousAudit?.id || null, input.currentAudit.id);
  const now = new Date().toISOString();
  const hasRecoveryWorkspace = Boolean(input.hasRecoveryWorkspace);

  let commercial_state: CommercialState = 'NO_SALE';
  let commercial_route: CommercialRoute = 'NO_SALE';
  let commercial_eligibility: CommercialEligibility = 'ineligible';

  if (current.recordsReviewed === 0) {
    commercial_state = 'R0-D';
    commercial_route = 'EVIDENCE_REMEDIATION';
    commercial_eligibility = 'recheck_later';
  } else if (current.findingsCount > 0) {
    if (hasRecoveryWorkspace || (comparison.recurring_burden && comparison.operational_burden_score >= 15)) {
      commercial_state = hasRecoveryWorkspace
        ? 'WORKSPACE'
        : comparison.recurring_burden
          ? 'R0-H'
          : 'R0-E';
      commercial_route = 'RECOVERY_CONTROL';
      commercial_eligibility = 'eligible';
    } else if (current.evidenceReadyCount > 0 && current.scopeValue > 0) {
      commercial_state = 'VERIFIED_RECOVERY';
      commercial_route = 'RECOVER_ONCE';
      commercial_eligibility = 'eligible';
    } else {
      commercial_state = 'R0-C';
      commercial_route = 'NURTURE';
      commercial_eligibility = 'manual_review';
    }
  } else if (comparison.previous_findings_count > 0 || comparison.previous_scope_value > 0) {
    commercial_state = 'R0-B';
    commercial_route = 'NO_SALE';
    commercial_eligibility = 'ineligible';
  } else if (current.sourcesUnavailable.length > 0) {
    commercial_state = 'R0-C';
    commercial_route = 'NURTURE';
    commercial_eligibility = 'recheck_later';
  } else if (comparison.recurring_burden) {
    commercial_state = 'R0-F';
    commercial_route = 'RECOVERY_CONTROL';
    commercial_eligibility = 'eligible';
  } else {
    commercial_state = 'R0-A';
    commercial_route = 'NO_SALE';
    commercial_eligibility = 'ineligible';
  }

  const commercial_evidence_basis = {
    current,
    comparison,
    hasRecoveryWorkspace,
    route: commercial_route,
    state: commercial_state,
    commercial_eligibility,
  };

  return {
    commercial_state,
    commercial_route,
    commercial_reason: buildReason(commercial_state, commercial_route, current, comparison, hasRecoveryWorkspace),
    commercial_eligibility,
    commercial_evidence_basis,
    commercial_decided_at: now,
    previous_audit_id: input.previousAudit?.id || null,
    last_audit_at: input.currentAudit.completed_at || input.currentAudit.started_at || input.currentAudit.created_at || now,
    next_eligible_at: new Date(new Date(input.currentAudit.completed_at || now).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    comparison,
  };
}

export function deriveFirstUsefulResult(summary: AuditSummaryLike | null | undefined): FirstUsefulResult {
  const current = analyzeAuditSummary(summary);
  let kind: FirstUsefulResultKind = 'r0_explanation';
  let message = 'Margin completed the audit and produced an honest recovery-control explanation.';

  if (current.findingsCount > 0 && current.scopeValue > 0) {
    kind = 'verified_recovery';
    message = `Margin identified ${current.findingsCount} recovery candidate${current.findingsCount === 1 ? '' : 's'} with ${current.evidenceReadyCount} evidence-ready item${current.evidenceReadyCount === 1 ? '' : 's'}.`;
  } else if (current.recordsReviewed === 0 || current.sourcesUnavailable.length > 0) {
    kind = 'material_data_limitation';
    message = current.recordsReviewed === 0
      ? 'Margin connected the audit path, but no usable Amazon records were available for review.'
      : `Margin reviewed available records and found coverage limitations: ${current.sourcesUnavailable.join(', ')}.`;
  } else if (current.recordsReviewed > 0) {
    kind = 'coverage_verified';
    message = `Margin reviewed ${current.recordsReviewed.toLocaleString()} Amazon record${current.recordsReviewed === 1 ? '' : 's'} and did not identify a paid recovery route from the available activity.`;
  }

  return {
    milestone: 'FIRST_USEFUL_RESULT',
    kind,
    message,
    evidence_basis: {
      scope_value: current.scopeValue,
      findings_count: current.findingsCount,
      evidence_ready_count: current.evidenceReadyCount,
      records_reviewed: current.recordsReviewed,
      categories: current.categories,
      sources_reviewed: current.sourcesReviewed,
      sources_unavailable: current.sourcesUnavailable,
      final_status: current.finalStatus,
    },
  };
}

export function buildControlStatement(input: {
  currentAudit: AuditRecordLike;
  commercialDecision: CommercialDecision;
}): ControlStatement {
  const current = analyzeAuditSummary(input.currentAudit.summary || null);
  const comparison = input.commercialDecision.comparison;
  const dataFreshness: ControlStatement['data_freshness'] =
    current.recordsReviewed === 0 || current.sourcesUnavailable.length > 0
      ? 'DATA_INCOMPLETE'
      : input.commercialDecision.commercial_route === 'NO_SALE'
        ? 'UNDER_CONTROL'
        : 'ACTION_REQUIRED';
  const generatedAt = input.commercialDecision.commercial_decided_at;

  return {
    coverage_start: input.commercialDecision.previous_audit_id
      ? input.currentAudit.started_at || input.currentAudit.created_at || generatedAt
      : input.currentAudit.started_at || input.currentAudit.created_at || generatedAt,
    coverage_end: input.currentAudit.completed_at || generatedAt,
    generated_at: generatedAt,
    data_freshness: dataFreshness,
    event_population: {
      records_reviewed: current.recordsReviewed,
      findings_count: current.findingsCount,
      scope_value: current.scopeValue,
      evidence_ready_count: current.evidenceReadyCount,
      sources_reviewed: current.sourcesReviewed,
      sources_unavailable: current.sourcesUnavailable,
    },
    automatic_reimbursements: Math.max(0, current.findingsCount - current.evidenceReadyCount),
    manual_reimbursements: current.evidenceReadyCount,
    reversals: Math.max(0, comparison.resolved_categories.length),
    exceptions_investigated: Math.max(0, comparison.new_categories.length + comparison.persistent_categories.length),
    unresolved_recoveries: current.findingsCount,
    evidence_gaps: current.sourcesUnavailable,
    deadlines_approaching: current.recordsReviewed > 0 && current.sourcesUnavailable.length > 0 ? ['Amazon records unavailable'] : [],
    open_cases: current.findingsCount,
    control_status:
      dataFreshness === 'DATA_INCOMPLETE'
        ? 'DATA_INCOMPLETE'
        : current.findingsCount > 0 || comparison.recurring_burden
          ? 'ACTION_REQUIRED'
          : 'UNDER_CONTROL',
    source_lineage: {
      previous_audit_id: input.commercialDecision.previous_audit_id,
      current_audit_id: input.currentAudit.id,
      comparison_available: comparison.comparison_available,
      recurring_burden: comparison.recurring_burden,
    },
    payload: {
      commercial_state: input.commercialDecision.commercial_state,
      commercial_route: input.commercialDecision.commercial_route,
      commercial_reason: input.commercialDecision.commercial_reason,
      commercial_eligibility: input.commercialDecision.commercial_eligibility,
      commercial_evidence_basis: input.commercialDecision.commercial_evidence_basis,
      comparison,
    },
  };
}
