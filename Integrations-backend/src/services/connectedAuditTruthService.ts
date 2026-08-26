export type ConnectedAuditTruthState =
  | 'connected_zero_operational_data'
  | 'limited_coverage'
  | 'reviewed_no_opportunities'
  | 'findings_available'
  | 'not_connected';

export interface ConnectedAuditTruthInput {
  sourceType?: unknown;
  syncStatus?: unknown;
  recordsReviewed?: unknown;
  findingsCount?: unknown;
  sourcesUnavailable?: unknown;
}

export interface ConnectedAuditTruthResult {
  state: ConnectedAuditTruthState;
  message: string;
  retryable: boolean;
  hasUsableOperationalData: boolean;
}

function positiveFiniteNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function unavailableSourceCount(value: unknown): number {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim()).filter(Boolean).length
    : 0;
}

function isConnectedSpApiSource(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'sp_api' || normalized === 'sp-api' || normalized === 'amazon_connected';
}

function isCompletedSync(value: unknown): boolean {
  return String(value || '').trim().toLowerCase() === 'completed';
}

/**
 * Classifies only the customer-facing data-truth state of a completed audit.
 * It never creates findings, values, claims, cases, reports, or provider requests.
 */
export function classifyConnectedAuditTruth(input: ConnectedAuditTruthInput): ConnectedAuditTruthResult {
  const recordsReviewed = positiveFiniteNumber(input.recordsReviewed);
  const findingsCount = positiveFiniteNumber(input.findingsCount);
  const unavailableCount = unavailableSourceCount(input.sourcesUnavailable);
  const connectedSpApi = isConnectedSpApiSource(input.sourceType);
  const completed = isCompletedSync(input.syncStatus);

  if (connectedSpApi && completed && recordsReviewed === 0 && findingsCount === 0) {
    return {
      state: 'connected_zero_operational_data',
      message: unavailableCount > 0
        ? 'Amazon connected successfully, but no usable Amazon records were available for this audit. Some sources were unavailable, so no recovery conclusion can be made.'
        : 'Amazon connected successfully, but no usable Amazon records were available for this audit. No recovery conclusion can be made until operational data is available.',
      retryable: true,
      hasUsableOperationalData: false,
    };
  }

  if (findingsCount > 0) {
    return {
      state: 'findings_available',
      message: unavailableCount > 0
        ? 'Margin found recovery candidates from the Amazon data available. Some datasets were unavailable, so the audit is limited.'
        : 'Margin found recovery candidates. Activate Margin to open the recovery workflow.',
      retryable: unavailableCount > 0,
      hasUsableOperationalData: recordsReviewed > 0,
    };
  }

  if (unavailableCount > 0 || recordsReviewed === 0) {
    return {
      state: 'limited_coverage',
      message: 'Margin completed the audit with limited Amazon data. No recovery candidates were found in the records available for review.',
      retryable: true,
      hasUsableOperationalData: recordsReviewed > 0,
    };
  }

  return {
    state: 'reviewed_no_opportunities',
    message: 'Margin reviewed the available Amazon activity and did not identify recovery opportunities in that audit window.',
    retryable: false,
    hasUsableOperationalData: true,
  };
}
