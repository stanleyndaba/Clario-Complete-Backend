type DetectionRow = Record<string, any>;
type DisputeCaseRow = Record<string, any> | null | undefined;

export type FilingMovementState =
  | 'preview_finding'
  | 'preparing_case'
  | 'evidence_needed'
  | 'ready_to_file'
  | 'queued_for_filing'
  | 'filed'
  | 'awaiting_payout'
  | 'completed'
  | 'blocked';

type PolicyBasis = {
  key: string;
  title: string;
  verification_status: 'official_reference_configured' | 'policy_basis_pending_verification';
  source_name: string;
  source_url: string;
  last_verified_at: string | null;
  summary: string;
  required_evidence: string[];
};

type SellerSummary = {
  title: string;
  summary: string;
  event_label: string;
  recoverability_reason: string;
  evidence_summary: string;
};

type FilingMovement = {
  state: FilingMovementState;
  label: string;
  detail: string;
  next_action_label: string;
  dispute_case_id: string | null;
  case_number: string | null;
  amazon_case_id: string | null;
  filing_status: string | null;
  case_state: string | null;
  eligibility_status: string | null;
  block_reasons: string[];
};

const OFFICIAL_POLICY_LAST_VERIFIED_AT = '2026-04-16';

const INVENTORY_REIMBURSEMENT_POLICY_URL =
  'https://sellercentral.amazon.com/help/hub/reference/G200213130';
const CUSTOMER_RETURNS_POLICY_URL =
  'https://sellercentral.amazon.com/help/hub/reference/G9N934L7Y4SFWPJ4';
const SELLING_FEES_POLICY_URL =
  'https://sellercentral.amazon.com/help/hub/reference/GTG4BAWSY39Z98Z3';

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
};

const numberValue = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const titleCase = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

const normalizeType = (row: DetectionRow): string =>
  clean(row?.evidence?.detection_type)
  || clean(row?.evidence?.whale_hunter?.detector)
  || clean(row?.anomaly_type)
  || 'unknown';

const evidenceToken = (evidence: Record<string, any>, keys: string[]): string | null => {
  for (const key of keys) {
    const direct = clean(evidence[key]);
    if (direct) return direct;
  }
  return null;
};

const joinTokens = (tokens: Array<string | null | undefined>) =>
  tokens.filter(Boolean).join(' · ');

const formatUnits = (value: unknown, fallback = 'units') => {
  const n = numberValue(value);
  if (n === null) return null;
  return `${n} ${Math.abs(n) === 1 ? fallback.replace(/s$/, '') : fallback}`;
};

const buildEvidenceSummary = (row: DetectionRow): string => {
  const evidence = asRecord(row.evidence);
  const sku = evidenceToken(evidence, ['sku', 'fnsku', 'asin']);
  const order = evidenceToken(evidence, ['order_id', 'amazon_order_id']);
  const shipment = evidenceToken(evidence, ['shipment_id']);
  const transfer = evidenceToken(evidence, ['transfer_id']);
  const settlement = evidenceToken(evidence, ['settlement_id']);
  const qtyGap =
    formatUnits(evidence.quantity_lost)
    || formatUnits(evidence.quantity_gap)
    || formatUnits(evidence.discrepancy)
    || formatUnits(evidence.missing_quantity)
    || formatUnits(evidence.quantity);

  const primaryRef = joinTokens([
    transfer ? `Transfer ${transfer}` : null,
    shipment ? `Shipment ${shipment}` : null,
    order ? `Order ${order}` : null,
    settlement ? `Settlement ${settlement}` : null,
    sku ? `SKU ${sku}` : null,
    qtyGap,
  ]);

  if (primaryRef) return primaryRef;

  const relatedIds = Array.isArray(row.related_event_ids) ? row.related_event_ids.filter(Boolean).slice(0, 3) : [];
  if (relatedIds.length) return `Related Amazon event IDs: ${relatedIds.join(', ')}`;

  return 'Structured evidence is available on the backend detection record.';
};

const policyBasisFor = (row: DetectionRow): PolicyBasis => {
  const anomalyType = String(row.anomaly_type || '').toLowerCase();
  const detectionType = String(clean(row?.evidence?.detection_type) || '').toLowerCase();

  if (
    anomalyType.includes('refund')
    || anomalyType.includes('return')
    || detectionType.includes('refund')
  ) {
    return {
      key: 'customer_return_reimbursement',
      title: 'FBA customer return and reimbursement review',
      verification_status: 'official_reference_configured',
      source_name: 'Amazon Seller Central Help',
      source_url: CUSTOMER_RETURNS_POLICY_URL,
      last_verified_at: OFFICIAL_POLICY_LAST_VERIFIED_AT,
      summary: 'Margin compares refund, return, restock, and reimbursement records to identify customer-return outcomes that may require seller review.',
      required_evidence: ['Order or refund identifier', 'Return/restock status', 'Settlement or reimbursement trail'],
    };
  }

  if (
    anomalyType.includes('fee')
    || anomalyType.includes('overcharge')
    || anomalyType.includes('commission')
    || anomalyType.includes('placement')
    || anomalyType.includes('storage')
  ) {
    return {
      key: 'seller_fee_schedule',
      title: 'Amazon selling and FBA fee schedule review',
      verification_status: 'official_reference_configured',
      source_name: 'Amazon Seller Central Help',
      source_url: SELLING_FEES_POLICY_URL,
      last_verified_at: OFFICIAL_POLICY_LAST_VERIFIED_AT,
      summary: 'Margin compares charged fees against the product, order, shipment, and fee context available in seller records.',
      required_evidence: ['Fee event', 'SKU or ASIN context', 'Expected fee basis', 'Charged amount'],
    };
  }

  if (
    anomalyType.includes('warehouse_transfer')
    || anomalyType.includes('inbound')
    || anomalyType.includes('lost')
    || anomalyType.includes('damaged')
    || anomalyType.includes('inventory')
    || anomalyType.includes('missing')
    || detectionType.includes('reimbursement')
    || detectionType.includes('clawback')
  ) {
    return {
      key: 'fba_inventory_reimbursement',
      title: 'FBA inventory reimbursement review',
      verification_status: 'official_reference_configured',
      source_name: 'Amazon Seller Central Help',
      source_url: INVENTORY_REIMBURSEMENT_POLICY_URL,
      last_verified_at: OFFICIAL_POLICY_LAST_VERIFIED_AT,
      summary: 'Margin compares inventory, shipment, transfer, adjustment, and reimbursement records to identify unit losses or unresolved reimbursement gaps.',
      required_evidence: ['SKU/FNSKU or ASIN', 'Quantity movement', 'Inventory or shipment event', 'Reimbursement or settlement trail'],
    };
  }

  return {
    key: 'policy_basis_pending_verification',
    title: 'Policy basis pending verification',
    verification_status: 'policy_basis_pending_verification',
    source_name: 'Amazon Seller Central Help',
    source_url: 'https://sellercentral.amazon.com/help',
    last_verified_at: null,
    summary: 'Margin has not mapped this detector to a curated policy reference yet. The finding should remain in review until policy support is confirmed.',
    required_evidence: ['Backend detection record', 'Supporting seller records', 'Manual policy confirmation'],
  };
};

const sellerSummaryFor = (row: DetectionRow): SellerSummary => {
  const anomalyType = String(row.anomaly_type || '').toLowerCase();
  const detectionType = String(clean(row?.evidence?.detection_type) || '').toLowerCase();
  const evidence = asRecord(row.evidence);
  const evidenceSummary = buildEvidenceSummary(row);

  if (anomalyType === 'reimbursement_duplicate_missed' || detectionType.includes('missed_reimbursement')) {
    const valueGap = clean(evidence.value_gap);
    const quantityGap = clean(evidence.quantity_gap);
    return {
      title: detectionType.includes('clawback') ? 'Clawback Risk Review' : 'Duplicate Reimbursement Missing',
      summary: joinTokens([
        'Amazon reimbursement activity does not reconcile with the expected loss and settlement trail.',
        quantityGap ? `Quantity gap ${quantityGap}` : null,
        valueGap ? `Value gap ${valueGap}` : null,
      ]),
      event_label: 'Reimbursement discrepancy',
      recoverability_reason: 'The detector found a mismatch between loss-side events and reimbursement-side events, so this needs review before Margin treats it as filing-ready.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType === 'warehouse_transfer_loss') {
    const sent = clean(evidence.quantity_sent);
    const received = clean(evidence.quantity_received);
    const lost = clean(evidence.quantity_lost);
    return {
      title: 'Warehouse Transfer Loss',
      summary: joinTokens([
        'A fulfillment-center transfer shows fewer units received than sent.',
        sent && received ? `${sent} sent, ${received} received` : null,
        lost ? `${lost} unresolved` : null,
      ]),
      event_label: 'Transfer discrepancy',
      recoverability_reason: 'The sent-versus-received transfer record creates a unit gap that may require reimbursement review when no offsetting recovery is present.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType.includes('inbound') || anomalyType === 'lost_inbound' || anomalyType === 'missing_unit') {
    const shipped = clean(evidence.quantity_shipped) || clean(evidence.shipped_quantity);
    const received = clean(evidence.quantity_received) || clean(evidence.received_quantity);
    return {
      title: anomalyType.includes('damage') ? 'Inbound Damage Review' : 'Inbound Shipment Shortage',
      summary: joinTokens([
        'An inbound shipment record does not reconcile with the quantity Amazon received.',
        shipped && received ? `${shipped} shipped, ${received} received` : null,
      ]),
      event_label: 'Inbound discrepancy',
      recoverability_reason: 'Margin is comparing shipment, receipt, and reimbursement records to determine whether the unresolved inbound gap can move into a case.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType.includes('damaged') || anomalyType.includes('lost_warehouse')) {
    const reasonCode = clean(evidence.reason_code);
    const disposition = clean(evidence.disposition);
    return {
      title: anomalyType.includes('lost') ? 'Warehouse Loss Review' : 'Warehouse Damage Review',
      summary: joinTokens([
        'Amazon inventory activity shows unresolved damage or loss inside the fulfillment workflow.',
        reasonCode ? `Reason code ${reasonCode}` : null,
        disposition ? `Disposition ${disposition}` : null,
      ]),
      event_label: 'Warehouse discrepancy',
      recoverability_reason: 'The inventory ledger shows a loss/damage signal that should be reconciled against recovery, found, or reimbursement events before filing.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType === 'lost_in_transit') {
    return {
      title: 'Lost In Transit Review',
      summary: 'Inventory movement signals show units that appear unresolved after expected transit or reconciliation windows.',
      event_label: 'Inventory movement discrepancy',
      recoverability_reason: 'Margin keeps this visible as a review rail so it is not silently compressed into another shortage or transfer finding.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType === 'refund_no_return' || anomalyType.includes('refund')) {
    return {
      title: 'Refund Without Return',
      summary: 'Amazon issued a refund, but the matching return or restock trail is not visible in the seller records.',
      event_label: 'Refund event discrepancy',
      recoverability_reason: 'The refund-side and return-side records do not reconcile, so Margin needs evidence that the customer return was not completed or restocked correctly.',
      evidence_summary: evidenceSummary,
    };
  }

  if (
    anomalyType.includes('fee')
    || anomalyType.includes('overcharge')
    || anomalyType.includes('commission')
    || anomalyType.includes('placement')
    || anomalyType.includes('storage')
  ) {
    const feeType = clean(evidence.fee_type);
    const charged = clean(evidence.charged_amount) || clean(evidence.total_charged);
    const expected = clean(evidence.expected_amount) || clean(evidence.total_expected);
    return {
      title: 'Fee Charge Review',
      summary: joinTokens([
        'A fee charge does not reconcile with the expected fee basis in seller records.',
        feeType,
        charged && expected ? `${charged} charged vs ${expected} expected` : null,
      ]),
      event_label: 'Fee discrepancy',
      recoverability_reason: 'Margin checks the fee event against the available product, order, shipment, and fee basis before treating it as a supported case.',
      evidence_summary: evidenceSummary,
    };
  }

  return {
    title: titleCase(String(row.anomaly_type || 'Detected discrepancy')),
    summary: 'Amazon records do not reconcile with the expected seller outcome for this finding.',
    event_label: 'Detected discrepancy',
    recoverability_reason: 'Margin is holding this finding in review until identifiers, evidence, and policy support line up.',
    evidence_summary: evidenceSummary,
  };
};

const toReasonList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean) as string[];
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean) as string[];
    } catch {
      return [value.trim()];
    }
  }
  return [];
};

const movementFor = (row: DetectionRow, disputeCase: DisputeCaseRow): FilingMovement => {
  const filingStatus = clean(disputeCase?.filing_status)?.toLowerCase() || null;
  const caseState = clean(disputeCase?.case_state)?.toLowerCase() || null;
  const status = clean(disputeCase?.status)?.toLowerCase() || null;
  const eligibilityStatus = clean(disputeCase?.eligibility_status) || null;
  const blockReasons = toReasonList(disputeCase?.block_reasons);
  const hasCase = Boolean(disputeCase?.id);

  const base = {
    dispute_case_id: clean(disputeCase?.id),
    case_number: clean(disputeCase?.case_number),
    amazon_case_id: clean(disputeCase?.amazon_case_id || disputeCase?.provider_case_id),
    filing_status: filingStatus,
    case_state: caseState,
    eligibility_status: eligibilityStatus,
    block_reasons: blockReasons,
  };

  if (!hasCase) {
    return {
      ...base,
      state: 'preview_finding',
      label: 'Preview finding',
      detail: 'Margin found this discrepancy. It has not been converted into a filing case yet.',
      next_action_label: 'Review finding',
    };
  }

  if (caseState === 'paid' || status === 'closed' || status === 'approved' && filingStatus === 'filed') {
    return {
      ...base,
      state: 'completed',
      label: 'Completed',
      detail: 'This case has reached a completed or paid-back state in Margin case truth.',
      next_action_label: 'Open recovery',
    };
  }

  if (caseState === 'approved' || status === 'approved' || filingStatus === 'recovering') {
    return {
      ...base,
      state: 'awaiting_payout',
      label: 'Awaiting payout',
      detail: 'Amazon approval or recovery movement is recorded; Margin is tracking payout confirmation.',
      next_action_label: 'Open recovery',
    };
  }

  if (filingStatus === 'filed' || status === 'submitted' || caseState === 'pending') {
    return {
      ...base,
      state: 'filed',
      label: 'Filed',
      detail: 'This finding is linked to a case that has been submitted or is under Amazon review.',
      next_action_label: 'Open case',
    };
  }

  if (filingStatus === 'filing' || filingStatus === 'submitting') {
    return {
      ...base,
      state: 'queued_for_filing',
      label: 'Queued for filing',
      detail: 'Margin is actively moving this case through the filing path.',
      next_action_label: 'Open case',
    };
  }

  if (filingStatus === 'pending' || filingStatus === 'retrying' || eligibilityStatus === 'READY') {
    return {
      ...base,
      state: 'ready_to_file',
      label: 'Ready to file',
      detail: 'This finding is linked to a case that can proceed when filing gates allow it.',
      next_action_label: 'Open case',
    };
  }

  if (
    filingStatus === 'pending_approval'
    || filingStatus === 'pending_safety_verification'
    || caseState === 'needs_evidence'
    || eligibilityStatus === 'INSUFFICIENT_DATA'
  ) {
    return {
      ...base,
      state: 'evidence_needed',
      label: 'Evidence needed',
      detail: 'The case exists, but Margin is still waiting on evidence or identifier verification before filing.',
      next_action_label: 'Review evidence',
    };
  }

  if (
    filingStatus === 'blocked'
    || filingStatus === 'failed'
    || filingStatus === 'payment_required'
    || filingStatus === 'duplicate_blocked'
    || filingStatus === 'already_reimbursed'
    || filingStatus === 'quarantined_dangerous_doc'
    || eligibilityStatus === 'DUPLICATE_BLOCKED'
    || eligibilityStatus === 'SAFETY_HOLD'
    || eligibilityStatus === 'THREAD_ONLY'
  ) {
    return {
      ...base,
      state: 'blocked',
      label: 'Blocked',
      detail: blockReasons.length
        ? `Margin is holding this case: ${blockReasons.slice(0, 2).join(', ')}.`
        : 'Margin is holding this case because a filing gate has not cleared.',
      next_action_label: 'View blocker',
    };
  }

  return {
    ...base,
    state: 'preparing_case',
    label: 'Preparing case',
    detail: 'Margin has linked this finding to a case and is preparing it for the next filing stage.',
    next_action_label: 'Open case',
  };
};

export const enrichDetectionFinding = (row: DetectionRow, disputeCase?: DisputeCaseRow) => {
  const detectedAt = clean(row.discovery_date) || clean(row.created_at) || null;
  const sellerSummary = sellerSummaryFor(row);
  const policyBasis = policyBasisFor(row);
  const filingMovement = movementFor(row, disputeCase);

  return {
    ...row,
    detected_at: detectedAt,
    detector_key: normalizeType(row),
    seller_summary: sellerSummary,
    policy_basis: policyBasis,
    filing_movement: filingMovement,
    next_action_label: filingMovement.next_action_label,
  };
};
