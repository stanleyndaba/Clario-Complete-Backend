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
  amazon_policy_rule: string;
  policy_window: {
    label: string;
    rule: string;
    start_event: string;
  };
  required_evidence: string[];
  required_documentation: Array<{
    label: string;
    detail: string;
  }>;
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

type ReviewTier = 'claim_candidate' | 'review_only' | 'monitoring';
type ClaimReadiness = 'claim_ready' | 'not_claim_ready';
type RecommendedAction = 'file_claim' | 'review' | 'monitor';
type ValueLabel = 'estimated_recovery' | 'potential_exposure' | 'no_recovery_value';

const OFFICIAL_POLICY_LAST_VERIFIED_AT = '2026-04-16';

const INVENTORY_REIMBURSEMENT_POLICY_URL =
  'https://sellercentral.amazon.com/help/hub/reference/GGEV4254LJJ9BAEG';
const CUSTOMER_RETURNS_POLICY_URL =
  INVENTORY_REIMBURSEMENT_POLICY_URL;
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

const formatCurrencyAmount = (value: unknown): string | null => {
  const n = numberValue(value);
  if (n === null) return null;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
};

const formatUnitGap = (value: unknown): string | null => {
  const n = numberValue(value);
  if (n === null) return null;
  return `${Math.abs(n)}-unit gap`;
};

const issueText = (evidence: Record<string, any>): string | null =>
  clean(evidence.autonomous_logic_summary)
  || clean(evidence.issue);

const inboundSummaryLeadFor = (evidence: Record<string, any>) => {
  const issue = String(issueText(evidence) || '').toLowerCase();
  if (issue.includes('supplier proof')) {
    return 'Amazon received fewer units than the inbound shipment record shows were shipped, and supplier proof is still missing for the gap.';
  }
  if (issue.includes('carrier') && issue.includes('window')) {
    return 'Amazon received fewer units than the inbound shipment record shows were shipped, but the current carrier proof falls outside the reimbursement window.';
  }
  return 'Amazon received fewer units than the inbound shipment record shows were shipped.';
};

const feeSummaryLeadFor = (evidence: Record<string, any>) => {
  const issue = String(issueText(evidence) || '').toLowerCase();
  const feeType = clean(evidence.fee_type);

  if (issue.includes('oversize') && issue.includes('standard-size')) {
    return 'Amazon applied an oversize fee to a SKU that seller records classify as standard-size.';
  }
  if (issue.includes('referral')) {
    return 'The referral fee charged on this order does not line up with the expected referral basis in seller records.';
  }
  if (issue.includes('weight tier')) {
    return 'The weight-tier fee charged does not line up with the product data and expected rate in seller records.';
  }
  if (issue.includes('storage')) {
    return 'A storage-related charge appears to have been applied more than the seller record supports.';
  }
  if (feeType) {
    return `${feeType} does not reconcile with the expected fee basis in seller records.`;
  }
  return 'This fee was charged on a basis that does not match the seller-side product, rate, or order context.';
};

const duplicateSummaryLeadFor = (evidence: Record<string, any>) => {
  const issue = String(issueText(evidence) || '').toLowerCase();

  if (issue.includes('reimbursement reversal')) {
    return 'A reimbursement reversal appears more than once against the same recovery path.';
  }
  if (issue.includes('long-term storage')) {
    return 'A long-term storage adjustment appears to have posted more than once for the same seller event.';
  }
  if (issue.includes('already reimbursed')) {
    return 'This charge path appears to duplicate an amount that was already reimbursed in settlement.';
  }
  return 'A charge or adjustment appears more than once against the same seller event, without a clean offset in the record trail.';
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

const reviewPresentationFor = (row: DetectionRow) => {
  const evidence = asRecord(row.evidence);
  const reviewTier = clean(evidence.review_tier) as ReviewTier | null;
  const claimReadiness = clean(evidence.claim_readiness) as ClaimReadiness | null;
  const recommendedAction = clean(evidence.recommended_action) as RecommendedAction | null;
  const valueLabel = clean(evidence.value_label) as ValueLabel | null;

  return {
    review_tier: reviewTier || 'claim_candidate',
    claim_readiness: claimReadiness || 'claim_ready',
    recommended_action: recommendedAction || 'file_claim',
    value_label: valueLabel || 'estimated_recovery',
    why_not_claim_ready: clean(evidence.why_not_claim_ready),
  };
};

const coverageFamilyFor = (row: DetectionRow): string => {
  const anomalyType = String(row.anomaly_type || '').toLowerCase();
  const detectionType = String(clean(row?.evidence?.detection_type) || '').toLowerCase();

  if (anomalyType.includes('warehouse_transfer')) return 'Transfer Auditor';
  if (anomalyType.includes('inbound') || anomalyType.includes('shipment')) return 'Inbound Inspector';
  if (anomalyType.includes('refund') || anomalyType.includes('return')) return 'Refund Trap';
  if (anomalyType.includes('fee') || anomalyType.includes('commission') || anomalyType.includes('storage')) return 'Fee Phantom';
  if (anomalyType.includes('lost') || anomalyType.includes('damaged')) return 'Whale Hunter';
  if (anomalyType.includes('found_without_prior_loss') || detectionType.includes('clawback') || anomalyType.includes('reimbursement_duplicate')) return 'Sentinel';
  return 'Launch detector';
};

const inventoryRequiredDocumentation = (
  anomalyType: string,
  detectionType: string
): PolicyBasis['required_documentation'] => {
  if (anomalyType.includes('warehouse_transfer')) {
    return [
      {
        label: 'Transfer and product identifiers',
        detail: 'Transfer ID plus the SKU, FNSKU, or ASIN for the exact units being reconciled.',
      },
      {
        label: 'Sent-versus-received quantity trail',
        detail: 'Units sent, units received, and the unresolved unit gap for the transfer.',
      },
      {
        label: 'Inventory movement events',
        detail: 'Transfer, adjustment, lost, damaged, or receiving events that explain the unit movement.',
      },
      {
        label: 'Settlement or reimbursement outcome',
        detail: 'Any reimbursement, reversal, or settlement transaction already posted for the same transfer/SKU.',
      },
    ];
  }

  if (anomalyType.includes('inbound') || anomalyType.includes('shipment')) {
    return [
      {
        label: 'Shipment and product identifiers',
        detail: 'Shipment ID plus the SKU, FNSKU, or ASIN for the row Amazon received short or damaged.',
      },
      {
        label: 'Shipped-versus-received quantity trail',
        detail: 'Units shipped or expected, units received by Amazon, and the remaining unresolved units.',
      },
      {
        label: 'Inbound receiving or discrepancy event',
        detail: 'Amazon receiving, shortage, damage, adjustment, or carrier event tied to the shipment.',
      },
      {
        label: 'Reimbursement or settlement trail',
        detail: 'Any reimbursement, reversal, or settlement transaction already posted for the same shipment/SKU.',
      },
    ];
  }

  if (detectionType.includes('clawback') || anomalyType.includes('reimbursement_duplicate')) {
    return [
      {
        label: 'Original loss or damage event',
        detail: 'The Amazon event that created the expected reimbursement obligation.',
      },
      {
        label: 'Expected reimbursement trail',
        detail: 'Expected unit/value recovery for the affected SKU, FNSKU, ASIN, shipment, or order.',
      },
      {
        label: 'Posted reimbursement and reversal trail',
        detail: 'Settlement, reimbursement, reversal, or clawback transactions tied to the same event.',
      },
      {
        label: 'Unresolved value or unit gap',
        detail: 'The remaining quantity or value that does not reconcile after posted reimbursements.',
      },
    ];
  }

  return [
    {
      label: 'SKU, FNSKU, or ASIN',
      detail: 'The exact product identifier for the units Amazon reported as lost, damaged, missing, or adjusted.',
    },
    {
      label: 'Inventory event record',
      detail: 'The Amazon lost, damaged, adjustment, transfer, or receiving event that created the discrepancy.',
    },
    {
      label: 'Quantity reconciliation',
      detail: 'Affected units, recovered units if any, and the unresolved quantity still requiring review.',
    },
    {
      label: 'Settlement or reimbursement trail',
      detail: 'Any reimbursement, reversal, or settlement transaction already posted for the same product/event.',
    },
  ];
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
      summary: 'Amazon sets a customer-return reimbursement window after the customer refund or replacement. Margin applies that reference only when the order, return/restock state, and reimbursement trail support seller review.',
      amazon_policy_rule: 'Customer-return reimbursement claims are windowed between 45 and 105 days after the customer refund or replacement event.',
      policy_window: {
        label: 'Customer return reimbursement window',
        rule: 'Between 45 and 105 days after customer refund or replacement.',
        start_event: 'Customer refund or replacement date',
      },
      required_evidence: ['Order or refund identifier', 'Return/restock status', 'Settlement or reimbursement trail'],
      required_documentation: [
        {
          label: 'Order and refund identifiers',
          detail: 'Amazon order ID, refund event ID, refund date, SKU, ASIN, and refunded quantity.',
        },
        {
          label: 'Return or restock outcome',
          detail: 'Whether the unit was returned, restocked, damaged, or still not matched to a return event.',
        },
        {
          label: 'Unit reconciliation',
          detail: 'Refunded units compared with returned, restocked, damaged, reimbursed, and unresolved units.',
        },
        {
          label: 'Settlement or reimbursement trail',
          detail: 'Refund, reimbursement, reversal, or settlement rows tied to the same order/SKU.',
        },
      ],
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
      summary: 'Amazon fee schedules define the fee basis by marketplace, product, order, shipment, and service context. Margin keeps fee findings in review until the charged event and expected fee basis reconcile.',
      amazon_policy_rule: 'Fee review depends on the specific Amazon fee type, marketplace, and charged event; Margin requires the fee event and expected fee basis before treating the finding as supported.',
      policy_window: {
        label: 'Fee review window',
        rule: 'Uses the stored detector deadline until a fee-specific official window is mapped for this event.',
        start_event: 'Charged fee or settlement event date',
      },
      required_evidence: ['Fee event', 'SKU or ASIN context', 'Expected fee basis', 'Charged amount'],
      required_documentation: [
        {
          label: 'Fee event or settlement row',
          detail: 'The charged fee transaction, fee type, settlement ID, order ID, or shipment context.',
        },
        {
          label: 'Product and marketplace context',
          detail: 'SKU/ASIN, marketplace, fulfillment channel, size tier, dimensions, weight, and category when available.',
        },
        {
          label: 'Expected fee basis',
          detail: 'The schedule version, rate basis, or calculation inputs Margin is comparing against the charge.',
        },
        {
          label: 'Charged-versus-expected amount',
          detail: 'The actual fee, expected fee, currency, and overcharge delta for the same event.',
        },
      ],
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
      summary: 'Amazon sets the FBA inventory reimbursement window for lost or damaged items. Margin applies that reference only when the affected product, unit movement, Amazon event, and reimbursement outcome reconcile.',
      amazon_policy_rule: 'Lost or damaged FBA inventory reimbursement claims must be submitted within 60 days of the reported loss or damage.',
      policy_window: {
        label: 'Lost or damaged FBA inventory window',
        rule: 'Within 60 days of reported loss or damage.',
        start_event: 'Reported loss or damage date',
      },
      required_evidence: ['SKU/FNSKU or ASIN', 'Quantity movement', 'Inventory or shipment event', 'Reimbursement or settlement trail'],
      required_documentation: inventoryRequiredDocumentation(anomalyType, detectionType),
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
    amazon_policy_rule: 'No curated Amazon policy rule has been mapped for this detector family yet.',
    policy_window: {
      label: 'Policy window pending verification',
      rule: 'Do not treat this finding as filing-ready until an official policy window is confirmed.',
      start_event: 'Manual policy review required',
    },
    required_evidence: ['Backend detection record', 'Supporting seller records', 'Manual policy confirmation'],
    required_documentation: [
      {
        label: 'Backend detection record',
        detail: 'The structured finding fields, source type, detected event, and evidence payload.',
      },
      {
        label: 'Supporting seller records',
        detail: 'Seller Central reports, settlements, inventory records, or uploaded documents tied to the event.',
      },
      {
        label: 'Manual Amazon policy confirmation',
        detail: 'The official Seller Central policy reference must be verified before filing support is shown.',
      },
    ],
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

  if (anomalyType === 'warehouse_transfer_overage_review') {
    const sent = clean(evidence.quantity_sent);
    const received = clean(evidence.quantity_received);
    const overage = clean(evidence.quantity_overage);
    return {
      title: 'Transfer Overage Review',
      summary: joinTokens([
        'A fulfillment-center transfer shows more units received than sent.',
        sent && received ? `${sent} sent, ${received} received` : null,
        overage ? `${overage} over-received` : null,
      ]),
      event_label: 'Transfer reconciliation review',
      recoverability_reason: 'This is not a recovery claim yet. Margin is surfacing the overage so the transfer records can be reconciled before any filing decision.',
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

  if (anomalyType === 'stuck_inbound_review') {
    const shipped = clean(evidence.quantity_shipped);
    const received = clean(evidence.quantity_received);
    const status = clean(evidence.shipment_status);
    return {
      title: 'Stuck Inbound Review',
      summary: joinTokens([
        'An inbound shipment is still non-terminal with units not yet received.',
        status ? `Status ${status}` : null,
        shipped && received ? `${shipped} shipped, ${received} received` : null,
      ]),
      event_label: 'Inbound monitoring review',
      recoverability_reason: 'The shipment is still in progress or unresolved, so Margin monitors it without treating it as claim-ready.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType === 'inbound_shortage_review') {
    const shipped = clean(evidence.quantity_shipped);
    const received = clean(evidence.quantity_received);
    return {
      title: 'Fresh Inbound Shortage Review',
      summary: joinTokens([
        'A closed inbound shipment shows a shortage, but the shortage is still inside Margin’s maturity window.',
        shipped && received ? `${shipped} shipped, ${received} received` : null,
      ]),
      event_label: 'Inbound maturity review',
      recoverability_reason: 'Margin keeps this visible while waiting for the claim window and reconciliation evidence to mature.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType.includes('inbound') || anomalyType === 'lost_inbound' || anomalyType === 'missing_unit') {
    const shipped = clean(evidence.quantity_shipped) || clean(evidence.shipped_quantity);
    const received = clean(evidence.quantity_received) || clean(evidence.received_quantity);
    const gap =
      formatUnitGap(evidence.quantity_gap)
      || formatUnitGap(evidence.missing_quantity)
      || (
        numberValue(shipped) !== null && numberValue(received) !== null
          ? formatUnitGap(Number(shipped) - Number(received))
          : null
      );
    const fulfillmentCenter = clean(evidence.fulfillment_center);
    return {
      title: anomalyType.includes('damage') ? 'Inbound Damage Review' : 'Inbound Shipment Shortage',
      summary: joinTokens([
        inboundSummaryLeadFor(evidence),
        shipped && received ? `${shipped} shipped, ${received} received` : null,
        gap && fulfillmentCenter ? `${gap} at ${fulfillmentCenter}` : gap || (fulfillmentCenter ? `FC ${fulfillmentCenter}` : null),
      ]),
      event_label: 'Inbound discrepancy',
      recoverability_reason: 'Margin is comparing shipment, receipt, and reimbursement records to determine whether the unresolved inbound gap can move into a case.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType === 'found_without_prior_loss_review') {
    return {
      title: 'Found Inventory Without Prior Loss',
      summary: 'An inventory found/recovery event appears without a prior loss event in this imported history.',
      event_label: 'Inventory reconciliation review',
      recoverability_reason: 'This is monitoring truth, not recoverable value. Margin keeps it visible to avoid reconciliation or clawback blind spots.',
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

  if (anomalyType === 'return_refund_missing_review') {
    return {
      title: 'Return Refund Missing Review',
      summary: 'A received return has no visible refund amount in the imported records.',
      event_label: 'Return/refund reconciliation review',
      recoverability_reason: 'Margin needs more reconciliation before deciding whether this is exposure, missing refund activity, or a record-timing issue.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType === 'refund_amount_mismatch_review') {
    return {
      title: 'Refund Amount Mismatch Review',
      summary: 'A refund amount is materially above the linked order total.',
      event_label: 'Refund amount review',
      recoverability_reason: 'This is exposure review, not an automatic claim. Margin is checking whether the refund amount, order total, and settlement trail reconcile.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType === 'settlement_refund_sign_review') {
    return {
      title: 'Refund Sign Review',
      summary: 'A settlement row labeled refund has a positive amount.',
      event_label: 'Settlement sign review',
      recoverability_reason: 'Margin preserves the sign mismatch for review before deciding whether it reflects a reversal, import convention, or financial anomaly.',
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

  if (anomalyType === 'fee_sign_polarity_review') {
    return {
      title: 'Fee Sign Polarity Review',
      summary: 'A fee row has a positive source amount before Margin normalizes fee signs.',
      event_label: 'Fee import review',
      recoverability_reason: 'This is not claim-ready. Margin is preserving the raw sign truth so fee charges, credits, and import conventions are not silently confused.',
      evidence_summary: evidenceSummary,
    };
  }

  if (anomalyType.includes('duplicate')) {
    const settlement = clean(evidence.settlement_id);
    const order = evidenceToken(evidence, ['order_id', 'amazon_order_id']);
    return {
      title: 'Duplicate Charge',
      summary: joinTokens([
        duplicateSummaryLeadFor(evidence),
        settlement ? `Settlement ${settlement}` : order ? `Order ${order}` : null,
      ]),
      event_label: 'Duplicate financial event',
      recoverability_reason: 'Margin found overlapping financial activity and is reconciling whether the seller was charged twice, reversed twice, or already reimbursed on the same path.',
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
    const feeLead = feeSummaryLeadFor(evidence);
    const charged =
      formatCurrencyAmount(evidence.charged_amount)
      || formatCurrencyAmount(evidence.total_charged)
      || clean(evidence.charged_amount)
      || clean(evidence.total_charged);
    const expected =
      formatCurrencyAmount(evidence.expected_amount)
      || formatCurrencyAmount(evidence.total_expected)
      || clean(evidence.expected_amount)
      || clean(evidence.total_expected);
    return {
      title: 'Fee Charge Review',
      summary: joinTokens([
        feeLead,
        !String(feeLead).toLowerCase().includes(String(feeType || '').toLowerCase()) ? feeType : null,
        charged && expected ? `${charged} charged vs ${expected} expected` : null,
      ]),
      event_label: 'Fee discrepancy',
      recoverability_reason: 'Margin checks the fee event against the available product, order, shipment, and fee basis before treating it as a supported case.',
      evidence_summary: evidenceSummary,
    };
  }

  return {
    title: titleCase(String(row.anomaly_type || 'Detected discrepancy')),
    summary: joinTokens([
      'Amazon activity does not reconcile with the seller-side record Margin linked to this finding.',
      issueText(evidence),
    ]),
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

const formatBlockReasonForSeller = (reason: string): string => {
  const normalized = String(reason || '').trim().toLowerCase();
  if (!normalized) return 'Filing hold';
  if (normalized.includes('review_only_detection_not_claim_ready')) return 'Review-only, not claim-ready';
  if (normalized.includes('duplicate')) return 'Possible duplicate';
  if (normalized.includes('already_reimbursed')) return 'Already reimbursed';
  if (normalized.includes('safety_hold')) return 'Safety hold';
  if (normalized.includes('thread_only')) return 'Thread-only case';
  if (normalized.includes('insufficient_data')) return 'Missing required evidence';
  if (normalized.includes('payment_required')) return 'Account setup required';
  if (normalized.includes('quarantined_dangerous_doc')) return 'Document safety hold';
  if (normalized.includes('redis_quota_exceeded')) return 'Filing queue paused';
  return titleCase(reason);
};

const sellerBlockedDetailFor = (row: DetectionRow, blockReasons: string[]): string => {
  const evidence = asRecord(row.evidence);
  const whyNotClaimReady = clean(evidence.why_not_claim_ready);
  const normalizedReasons = blockReasons.map(reason => reason.toLowerCase());
  const hasReviewOnlyHold = normalizedReasons.some(reason => reason.includes('review_only_detection_not_claim_ready'));
  const hasDuplicateHold = normalizedReasons.some(reason => reason.includes('duplicate'));
  const hasAlreadyReimbursedHold = normalizedReasons.some(reason => reason.includes('already_reimbursed'));
  const hasEvidenceHold = normalizedReasons.some(reason => reason.includes('insufficient_data'));

  if (whyNotClaimReady) {
    return `Margin is holding this finding before filing. ${whyNotClaimReady}`;
  }

  if (hasReviewOnlyHold) {
    return 'Margin is holding this finding because it is review-only and not claim-ready yet. It needs a supported loss, missing reimbursement, or clear policy/evidence basis before any Amazon filing.';
  }

  if (hasDuplicateHold) {
    return 'Margin is holding this finding because a possible duplicate or previously handled recovery path exists. It should not be filed again until that is reconciled.';
  }

  if (hasAlreadyReimbursedHold) {
    return 'Margin is holding this finding because a reimbursement or payout trail already appears linked to it. Filing again could create a duplicate claim.';
  }

  if (hasEvidenceHold) {
    return 'Margin is holding this finding because required identifiers, documents, or reconciliation records are not complete enough to support filing yet.';
  }

  if (blockReasons.length) {
    return `Margin is holding this finding before filing. Reason: ${blockReasons.slice(0, 2).map(formatBlockReasonForSeller).join(', ')}.`;
  }

  return 'Margin is holding this finding because a filing gate has not cleared yet.';
};

const movementFor = (row: DetectionRow, disputeCase: DisputeCaseRow): FilingMovement => {
  const filingStatus = clean(disputeCase?.filing_status)?.toLowerCase() || null;
  const caseState = clean(disputeCase?.case_state)?.toLowerCase() || null;
  const status = clean(disputeCase?.status)?.toLowerCase() || null;
  const eligibilityStatus = clean(disputeCase?.eligibility_status) || null;
  const blockReasons = toReasonList(disputeCase?.block_reasons);
  const hasCase = Boolean(disputeCase?.id);
  const submissionProof = asRecord(disputeCase?.submission_proof);
  const hasSubmissionProof = submissionProof.proof_present === true;
  const hasAmazonReference = Boolean(
    clean(disputeCase?.amazon_case_id || disputeCase?.provider_case_id) ||
    clean(submissionProof.amazon_case_id) ||
    clean(submissionProof.external_reference) ||
    clean(submissionProof.proof_reference)
  );
  const hasFiledTruth = Boolean(disputeCase?.has_filing_truth) ||
    hasSubmissionProof ||
    hasAmazonReference;
  const hasApprovalTruth = Boolean(disputeCase?.has_approval_truth) ||
    (hasFiledTruth && (caseState === 'approved' || status === 'approved'));

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

  if (caseState === 'paid' || (status === 'closed' && hasApprovalTruth) || (status === 'approved' && filingStatus === 'filed' && hasApprovalTruth)) {
    return {
      ...base,
      state: 'completed',
      label: 'Completed',
      detail: 'This case has reached a completed or paid-back state in Margin case truth.',
      next_action_label: 'Open recovery',
    };
  }

  if (hasApprovalTruth || filingStatus === 'recovering') {
    return {
      ...base,
      state: 'awaiting_payout',
      label: 'Awaiting payout',
      detail: 'Amazon approval or recovery movement is recorded; Margin is tracking payout confirmation.',
      next_action_label: 'Open recovery',
    };
  }

  if (hasFiledTruth) {
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
      detail: sellerBlockedDetailFor(row, blockReasons),
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
  const reviewPresentation = reviewPresentationFor(row);

  return {
    ...row,
    detected_at: detectedAt,
    detector_key: normalizeType(row),
    coverage_family: coverageFamilyFor(row),
    ...reviewPresentation,
    seller_summary: sellerSummary,
    policy_basis: policyBasis,
    filing_movement: filingMovement,
    next_action_label: filingMovement.next_action_label,
  };
};
