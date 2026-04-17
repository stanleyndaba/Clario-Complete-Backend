export type DetectorCoverageDisposition = 'claim_candidate' | 'review_only' | 'monitoring';

export interface DetectorCoverageEntry {
  family: string;
  detector_key: string;
  launch_set: boolean;
  primary_disposition: DetectorCoverageDisposition;
  catches: string[];
  evidence_required: string[];
  intentionally_ignores: string[];
  archived_owner_for_out_of_scope?: string;
}

const COVERAGE_MAP: DetectorCoverageEntry[] = [
  {
    family: 'Whale Hunter',
    detector_key: 'whale_hunter',
    launch_set: true,
    primary_disposition: 'claim_candidate',
    catches: ['Lost warehouse inventory', 'lost-in-transit inventory movement gaps', 'unresolved inventory ledger losses'],
    evidence_required: ['SKU/FNSKU or ASIN', 'inventory ledger movement', 'quantity gap', 'valuation basis'],
    intentionally_ignores: ['Customer return fraud', 'fee-rate math', 'order-total integrity anomalies'],
    archived_owner_for_out_of_scope: 'Return Integrity / Order Integrity archived families',
  },
  {
    family: 'Transfer Auditor',
    detector_key: 'transfer_auditor',
    launch_set: true,
    primary_disposition: 'claim_candidate',
    catches: ['FC-to-FC transfer sent greater than received', 'long-running transfer delays', 'transfer overage review anomalies'],
    evidence_required: ['Transfer ID', 'source and destination FC', 'sent quantity', 'received quantity', 'SKU/FNSKU'],
    intentionally_ignores: ['Inbound PO receipt mismatches', 'customer return refunds', 'standalone order duplicate checks'],
    archived_owner_for_out_of_scope: 'Inventory Reconciliation archived family',
  },
  {
    family: 'Inbound Inspector',
    detector_key: 'inbound_inspector',
    launch_set: true,
    primary_disposition: 'claim_candidate',
    catches: ['Closed inbound shortages', 'missing inbound shipment units', 'carrier damage and receiving error signals', 'stuck inbound review states'],
    evidence_required: ['Shipment ID', 'SKU/FNSKU', 'shipped quantity', 'received quantity', 'shipment status/date'],
    intentionally_ignores: ['Order duplicate integrity', 'fee sign polarity', 'customer refund mismatch outside inbound context'],
    archived_owner_for_out_of_scope: 'Shipment Lifecycle archived family',
  },
  {
    family: 'Broken Goods',
    detector_key: 'broken_goods',
    launch_set: true,
    primary_disposition: 'claim_candidate',
    catches: ['Warehouse damage', 'misplaced inventory', 'found/damaged offsets with unresolved loss'],
    evidence_required: ['Inventory ledger event', 'reason code or disposition', 'SKU/FNSKU', 'quantity movement'],
    intentionally_ignores: ['Transfers with transfer IDs', 'fee classification errors', 'duplicate order rows'],
    archived_owner_for_out_of_scope: 'Return Disposition archived family',
  },
  {
    family: 'Refund Trap',
    detector_key: 'refund_trap',
    launch_set: true,
    primary_disposition: 'claim_candidate',
    catches: ['Refund without return', 'return received with missing refund review', 'refund amount mismatch review', 'positive refund settlement review'],
    evidence_required: ['Order ID', 'refund/settlement row', 'return row when present', 'amount and quantity context'],
    intentionally_ignores: ['Inventory transfer loss', 'storage fee rate math', 'duplicate order import anomalies'],
    archived_owner_for_out_of_scope: 'Returns Abuse / Order Integrity archived families',
  },
  {
    family: 'Fee Phantom',
    detector_key: 'fee_phantom',
    launch_set: true,
    primary_disposition: 'claim_candidate',
    catches: ['Fee overcharge candidates', 'duplicate fees', 'fee sign polarity review anomalies'],
    evidence_required: ['Fee event', 'fee type', 'charged amount', 'expected fee basis or sign expectation'],
    intentionally_ignores: ['Inbound shipment shortages', 'inventory found-without-loss reconciliation', 'refund-without-return'],
    archived_owner_for_out_of_scope: 'Advanced Fee Audit archived families',
  },
  {
    family: 'Sentinel',
    detector_key: 'sentinel',
    launch_set: true,
    primary_disposition: 'review_only',
    catches: ['Duplicate/missed reimbursement patterns', 'clawback risk', 'found-without-prior-loss reconciliation review'],
    evidence_required: ['Loss-side event', 'settlement or reimbursement trail', 'reference entity', 'quantity/value gap'],
    intentionally_ignores: ['Claim filing without evidence links', 'new detector families outside the launch seven'],
    archived_owner_for_out_of_scope: 'Recovery Integrity archived family',
  },
];

export function getDetectorCoverageMap() {
  return COVERAGE_MAP;
}

export default { getDetectorCoverageMap };
