export type OperationalState =
  | 'READY'
  | 'DEFERRED_EXPLICIT'
  | 'RETRY_SCHEDULED'
  | 'BLOCKED_OPERATIONAL'
  | 'FAILED_DURABLE';

export interface OperationalExplanation {
  reason: string;
  retry_at?: string;
  blocking_guard?: string;
  next_action?: string;
}

export function normalizeOperationalExplanation(
  explanation?: Partial<OperationalExplanation> | null,
  fallbackReason: string = 'Operational decision recorded.'
): OperationalExplanation {
  return {
    reason: String(explanation?.reason || '').trim() || fallbackReason,
    retry_at: explanation?.retry_at ? String(explanation.retry_at) : undefined,
    blocking_guard: explanation?.blocking_guard ? String(explanation.blocking_guard) : undefined,
    next_action: explanation?.next_action ? String(explanation.next_action) : undefined
  };
}

export function buildOperationalDecision(
  operationalState: OperationalState,
  explanation?: Partial<OperationalExplanation> | null,
  fallbackReason?: string
): {
  operational_state: OperationalState;
  operational_explanation: OperationalExplanation;
} {
  return {
    operational_state: operationalState,
    operational_explanation: normalizeOperationalExplanation(explanation, fallbackReason)
  };
}

