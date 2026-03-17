import { InventoryLedgerEvent } from '../services/detection/core/detectors/inventoryAlgorithms';

export interface WhaleHunterScenario {
    scenario_id: string;
    family: string;
    description: string;
    expected_detector_outcome: 'positive' | 'negative' | 'suppressed';
    expected_unresolved_units: number;
    physical_loss_truth: number;
    claimable_truth: number;
    expected_recoverable_value?: number;
    expected_value_status: 'full' | 'partial' | 'zero' | 'unknown';
    rationale: string;
    events: InventoryLedgerEvent[];
    financial_events?: any[];
}

const MOCK_SELLER_A = 'seller-alpha';
const MOCK_SELLER_B = 'seller-beta';

const daysAgo = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
};

export const WHALE_HUNTER_SCENARIOS: WhaleHunterScenario[] = [
    // --- FAMILY A: Healthy conservation (5) ---
    {
        scenario_id: 'A1-PERFECT-FLOW',
        family: 'A: Healthy conservation',
        description: 'Standard stock flow.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Balanced ledger.',
        events: [
            { id: 'a1-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A1', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'a1-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A1', event_type: 'Shipment', quantity: 100, quantity_direction: 'out', event_date: daysAgo(30), created_at: daysAgo(30) },
            { id: 'a1-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A1', event_type: 'Snapshot', quantity: 0, warehouse_balance: 0, quantity_direction: 'out', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'A2-FC-TRANSFER-SAFE',
        family: 'A: Healthy conservation',
        description: 'Transfer within SLA.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Transfer out and in within 10 days.',
        events: [
            { id: 'a2-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A2', event_type: 'Transfer', quantity: -50, quantity_direction: 'out', reference_id: 'XFER-1', event_date: daysAgo(15), created_at: daysAgo(15) },
            { id: 'a2-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A2', event_type: 'Transfer', quantity: 50, quantity_direction: 'in', reference_id: 'XFER-1', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'A3-ADJUSTMENT-WASH',
        family: 'A: Healthy conservation',
        description: 'Misplaced and Found.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Adjustment M (Misplaced) matched by Adjustment F (Found) quickly.',
        events: [
            { id: 'a3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A3', event_type: 'Adjustment', quantity: -10, quantity_direction: 'out', reason: 'M', event_date: daysAgo(20), created_at: daysAgo(20) },
            { id: 'a3-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A3', event_type: 'Adjustment', quantity: 10, quantity_direction: 'in', reason: 'F', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'A4-PARTIAL-SALES',
        family: 'A: Healthy conservation',
        description: 'Bulk receipt, gradual sales.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Total receipts = Total shipments + Balance.',
        events: [
            { id: 'a4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A4', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(50), created_at: daysAgo(50) },
            { id: 'a4-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A4', event_type: 'Shipment', quantity: -40, quantity_direction: 'out', event_date: daysAgo(30), created_at: daysAgo(30) },
            { id: 'a4-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A4', event_type: 'Snapshot', quantity: 60, warehouse_balance: 60, quantity_direction: 'in', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'A5-RETURN-RESTORE',
        family: 'A: Healthy conservation',
        description: 'Return to sellable.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Customer return adds back to balance correctly.',
        events: [
            { id: 'a5-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A5', event_type: 'Receipt', quantity: 10, quantity_direction: 'in', event_date: daysAgo(60), created_at: daysAgo(60) },
            { id: 'a5-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A5', event_type: 'Shipment', quantity: -10, quantity_direction: 'out', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'a5-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A5', event_type: 'Return', quantity: 10, quantity_direction: 'in', event_date: daysAgo(20), created_at: daysAgo(20) },
            { id: 'a5-4', seller_id: MOCK_SELLER_A, fnsku: 'SKU-A5', event_type: 'Snapshot', quantity: 10, warehouse_balance: 10, quantity_direction: 'in', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },

    // --- FAMILY B: True loss (5) ---
    {
        scenario_id: 'B1-CLASSIC-WHALE',
        family: 'B: True loss',
        description: '100 shipped, but ledger says 0 remain despite no sales.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 100,
        physical_loss_truth: 100,
        claimable_truth: 100,
        expected_value_status: 'full',
        rationale: 'Units entered but never exited via known channels.',
        events: [
            { id: 'b1-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B1', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(50), created_at: daysAgo(50) },
            { id: 'b1-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B1', event_type: 'Snapshot', quantity: 0, warehouse_balance: 0, quantity_direction: 'out', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'B2-GHOST-TRANSFER-PROMOTED',
        family: 'B: True loss',
        description: 'Transfer out, never arrived (45 days ago).',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 50,
        physical_loss_truth: 50,
        claimable_truth: 50,
        expected_value_status: 'full',
        rationale: 'Past 30-day transfer maturity.',
        events: [
            { id: 'b2-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B2', event_type: 'Transfer', quantity: -50, quantity_direction: 'out', reference_id: 'XFER-B2', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 'b2-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B2', event_type: 'Snapshot', quantity: 0, warehouse_balance: 0, quantity_direction: 'out', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'B3-ADJUSTMENT-M-UNRESOLVED',
        family: 'B: True loss',
        description: 'Misplaced (M) 60 days ago, no F found.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 10,
        physical_loss_truth: 10,
        claimable_truth: 10,
        expected_value_status: 'full',
        rationale: 'Permanent negative adjustment without balancing found event.',
        events: [
            { id: 'b3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B3', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(80), created_at: daysAgo(80) },
            { id: 'b3-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B3', event_type: 'Adjustment', quantity: -10, quantity_direction: 'out', reason: 'M', event_date: daysAgo(60), created_at: daysAgo(60) },
            { id: 'b3-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B3', event_type: 'Snapshot', quantity: 90, warehouse_balance: 90, quantity_direction: 'in', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'B4-PARTIAL-RECEIPT-GAP',
        family: 'B: True loss',
        description: '90 received vs 100 in shipment.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 10,
        physical_loss_truth: 10,
        claimable_truth: 10,
        expected_value_status: 'full',
        rationale: 'Shortage detected at receiving point.',
        events: [
            { id: 'b4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B4', event_type: 'Receipt', quantity: 90, quantity_direction: 'in', event_date: daysAgo(50), created_at: daysAgo(50) },
            { id: 'b4-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B4', event_type: 'Snapshot', quantity: 90, warehouse_balance: 90, quantity_direction: 'in', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'B5-REMOVAL-SHORTAGE',
        family: 'B: True loss',
        description: 'Removal order for 10, but ledger deducted 10 without physical exit.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 10,
        physical_loss_truth: 10,
        claimable_truth: 10,
        expected_value_status: 'full',
        rationale: 'Ledger mismatch during removal processing.',
        events: [
            { id: 'b5-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B5', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(90), created_at: daysAgo(90) },
            { id: 'b5-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B5', event_type: 'Removal', quantity: -10, quantity_direction: 'out', event_date: daysAgo(60), created_at: daysAgo(60) },
            { id: 'b5-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-B5', event_type: 'Snapshot', quantity: 80, warehouse_balance: 80, quantity_direction: 'in', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },

    // --- FAMILY C: Late legitimate resolution (5) ---
    {
        scenario_id: 'C1-LATE-FOUND',
        family: 'C: Late legitimate resolution',
        description: 'Lost 30 days ago, Found 2 days ago.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Resolution occurred before sync.',
        events: [
            { id: 'c1-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C1', event_type: 'Adjustment', quantity: -5, quantity_direction: 'out', reason: 'M', event_date: daysAgo(30), created_at: daysAgo(30) },
            { id: 'c1-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C1', event_type: 'Adjustment', quantity: 5, quantity_direction: 'in', reason: 'F', event_date: daysAgo(2), created_at: daysAgo(2) },
            { id: 'c1-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C1', event_type: 'Snapshot', warehouse_balance: 5, quantity: 5, quantity_direction: 'in', event_date: daysAgo(1), created_at: daysAgo(1) }
        ]
    },
    {
        scenario_id: 'C2-LATE-TRANSFER',
        family: 'C: Late legitimate resolution',
        description: 'Transfer arrives on day 29.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Arrived before 30-day maturity threshold.',
        events: [
            { id: 'c2-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C2', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'T-C2', event_date: daysAgo(29), created_at: daysAgo(29) },
            { id: 'c2-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C2', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'T-C2', event_date: daysAgo(1), created_at: daysAgo(1) }
        ]
    },
    {
        scenario_id: 'C3-ADJUSTMENT-REVERSAL',
        family: 'C: Late legitimate resolution',
        description: 'Accidental removal reversed by positive adjustment.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Corrected in ledger via manual override.',
        events: [
            { id: 'c3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C3', event_type: 'Adjustment', quantity: -50, quantity_direction: 'out', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'c3-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C3', event_type: 'Adjustment', quantity: 50, quantity_direction: 'in', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'C4-LATE-RETURN-IN',
        family: 'C: Late legitimate resolution',
        description: 'Customer return arrives after shipment but before 45-day SLA.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Balanced within window.',
        events: [
            { id: 'c4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C4', event_type: 'Shipment', quantity: -1, quantity_direction: 'out', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'c4-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C4', event_type: 'Return', quantity: 1, quantity_direction: 'in', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },
    {
        scenario_id: 'C5-SNAPSHOT-RECOVERY',
        family: 'C: Late legitimate resolution',
        description: 'Stock missing in snap 1, appears in snap 2 without events.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Ghost inventory corrected by subsequent warehouse audit.',
        events: [
            { id: 'c5-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C5', event_type: 'Snapshot', quantity: 0, warehouse_balance: 0, quantity_direction: 'out', event_date: daysAgo(30), created_at: daysAgo(30) },
            { id: 'c5-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-C5', event_type: 'Snapshot', quantity: 10, warehouse_balance: 10, quantity_direction: 'in', event_date: daysAgo(1), created_at: daysAgo(1) }
        ]
    },

    // --- FAMILY D: Boundary attacks (5) ---
    {
        scenario_id: 'D1-THRESHOLD-MINUS-ONE',
        family: 'D: Boundary attacks',
        description: 'Transfer out 29 days ago.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Still within 30-day "Escrow" safety period.',
        events: [
            { id: 'd1-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-D1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'TR-D1', event_date: daysAgo(29), created_at: daysAgo(29) }
        ]
    },
    {
        scenario_id: 'D2-THRESHOLD-EXACT',
        family: 'D: Boundary attacks',
        description: 'Transfer out exactly 30 days ago.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 100,
        physical_loss_truth: 100,
        claimable_truth: 100,
        expected_value_status: 'full',
        rationale: 'Maturity trigger point.',
        events: [
            { id: 'd2-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-D2', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'TR-D2', event_date: daysAgo(30), created_at: daysAgo(30) }
        ]
    },
    {
        scenario_id: 'D3-THRESHOLD-PLUS-ONE',
        family: 'D: Boundary attacks',
        description: 'Transfer out 31 days ago.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 100,
        physical_loss_truth: 100,
        claimable_truth: 100,
        expected_value_status: 'full',
        rationale: 'Clearly past maturity.',
        events: [
            { id: 'd3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-D3', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'TR-D3', event_date: daysAgo(31), created_at: daysAgo(31) }
        ]
    },
    {
        scenario_id: 'D4-SYNC-ID-DRIFT',
        family: 'D: Boundary attacks',
        description: 'Adjustment occurred at sync boundary.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Ambiguity at edge of sync window should be suppressed if too fresh.',
        events: [
            { id: 'd4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-D4', event_type: 'Adjustment', quantity: -10, quantity_direction: 'out', event_date: daysAgo(0), created_at: daysAgo(0) }
        ]
    },
    {
        scenario_id: 'D5-SLA-WINDOW-PRESSURE',
        family: 'D: Boundary attacks',
        description: 'Multi-hop transfer near boundary.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'First hop 25 days ago, second hop 10 days ago.',
        events: [
            { id: 'd5-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-D5', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X1', event_date: daysAgo(25), created_at: daysAgo(25) },
            { id: 'd5-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-D5', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'X1', event_date: daysAgo(20), created_at: daysAgo(20) },
            { id: 'd5-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-D5', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X2', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },

    // --- FAMILY E: Duplicate contamination (5) ---
    {
        scenario_id: 'E1-ID-COLLISION',
        family: 'E: Duplicate contamination',
        description: 'Two identical ledger entries.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Harness should deduplicate by ID.',
        events: [
            { id: 'dup-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E1', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'dup-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E1', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'exit-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E1', event_type: 'Shipment', quantity: -100, quantity_direction: 'out', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'E2-TIMESTAMP-DRIFT-DUPS',
        family: 'E: Duplicate contamination',
        description: 'Same event, slightly different created_at.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Heuristic deduplication required.',
        events: [
            { id: 'e2-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E2', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'e2-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E2', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40).replace(':00.', ':01.') },
            { id: 'e2-exit', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E2', event_type: 'Shipment', quantity: -100, quantity_direction: 'out', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'E3-DOUBLE-NET-FLICKER',
        family: 'E: Duplicate contamination',
        description: 'Transfer out twice, transfer in once.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 50,
        physical_loss_truth: 50,
        claimable_truth: 50,
        expected_value_status: 'full',
        rationale: 'Real loss masked by duplicate noise.',
        events: [
            { id: 'e3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E3', event_type: 'Transfer', quantity: -50, quantity_direction: 'out', reference_id: 'R1', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'e3-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E3', event_type: 'Transfer', quantity: -50, quantity_direction: 'out', reference_id: 'R2', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'e3-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E3', event_type: 'Transfer', quantity: 50, quantity_direction: 'in', reference_id: 'R1', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'E4-PHANTOM-RECEIPT',
        family: 'E: Duplicate contamination',
        description: 'One receipt, two snapshot additions.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Healthy state.',
        events: [
            { id: 'e4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E4', event_type: 'Receipt', quantity: 10, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'e4-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E4', event_type: 'Snapshot', quantity: 0, warehouse_balance: 10, quantity_direction: 'in', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'E5-GHOST-DUPLICATE-DANGER',
        family: 'E: Duplicate contamination',
        description: 'Negative adjustment duplicated in history.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 10,
        physical_loss_truth: 10,
        claimable_truth: 10,
        expected_value_status: 'full',
        rationale: 'Detect actual loss despite duplicate noise.',
        events: [
            { id: 'e5-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E5', event_type: 'Adjustment', quantity: -10, quantity_direction: 'out', reason: 'M', event_date: daysAgo(60), created_at: daysAgo(60) },
            { id: 'e5-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-E5', event_type: 'Adjustment', quantity: -10, quantity_direction: 'out', reason: 'M', event_date: daysAgo(60), created_at: daysAgo(60) }
        ]
    },

    // --- FAMILY F: Identifier chaos (5) ---
    {
        scenario_id: 'F1-MISSING-REF-ID',
        family: 'F: Identifier chaos',
        description: 'Transfer without reference_id.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 100,
        physical_loss_truth: 100,
        claimable_truth: 100,
        expected_value_status: 'full',
        rationale: 'Should fall back to date-based netting or catch as unreferenced gap.',
        events: [
            { id: 'f1-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-F1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', event_date: daysAgo(40), created_at: daysAgo(40) }
        ]
    },
    {
        scenario_id: 'F2-SKU-OVERLAP',
        family: 'F: Identifier chaos',
        description: 'Two separate FNSKUs for same SKU.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Whale Hunter groups by FNSKU, so this should stay separate and healthy.',
        events: [
            { id: 'f2-1', seller_id: MOCK_SELLER_A, fnsku: 'FNSKU-1', sku: 'REAL-SKU', event_type: 'Receipt', quantity: 10, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'f2-2', seller_id: MOCK_SELLER_A, fnsku: 'FNSKU-2', sku: 'REAL-SKU', event_type: 'Receipt', quantity: 10, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) }
        ]
    },
    {
        scenario_id: 'F3-REMAPPED-IDS',
        family: 'F: Identifier chaos',
        description: 'Outbound Ref A, Inbound Ref B.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Heuristic should link by quantity/date if IDs fail.',
        events: [
            { id: 'f3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-F3', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'REF-OLD', event_date: daysAgo(20), created_at: daysAgo(20) },
            { id: 'f3-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-F3', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'REF-NEW', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'F4-FC-COLLISION',
        family: 'F: Identifier chaos',
        description: 'Events from conflicting FCs.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Global netting ignores FC paths for loss detection.',
        events: [
            { id: 'f4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-F4', event_type: 'Receipt', quantity: 10, quantity_direction: 'in', fulfillment_center_id: 'FC1', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'f4-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-F4', event_type: 'Shipment', quantity: -10, quantity_direction: 'out', fulfillment_center_id: 'FC2', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'F5-UNDEFINED-METADATA',
        family: 'F: Identifier chaos',
        description: 'Null FNSKU (should be suppressed).',
        expected_detector_outcome: 'suppressed',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'unknown',
        rationale: 'Safety protocols should ignore garbage data.',
        events: [
            { id: 'f5-1', seller_id: MOCK_SELLER_A, fnsku: '', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) }
        ]
    },

    // --- FAMILY G: Multi-stage transfer ambiguity (4) ---
    {
        scenario_id: 'G1-HUB-AND-SPOKE-STUCK',
        family: 'G: Multi-stage transfer ambiguity',
        description: 'Shipped from FC1, arrived at FC2, shipped to FC3 (Stuck).',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 10,
        physical_loss_truth: 10,
        claimable_truth: 10,
        expected_value_status: 'full',
        rationale: 'Loss at the second hop.',
        events: [
            { id: 'g1-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G1', event_type: 'Transfer', quantity: -10, quantity_direction: 'out', reference_id: 'LEG-1', event_date: daysAgo(50), created_at: daysAgo(50) },
            { id: 'g1-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G1', event_type: 'Transfer', quantity: 10, quantity_direction: 'in', reference_id: 'LEG-1', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 'g1-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G1', event_type: 'Transfer', quantity: -10, quantity_direction: 'out', reference_id: 'LEG-2', event_date: daysAgo(40), created_at: daysAgo(40) }
        ]
    },
    {
        scenario_id: 'G2-PARTIAL-MULTI-FC',
        family: 'G: Multi-stage transfer ambiguity',
        description: '100 shipped to Hub, redistributed as 40+40 (20 lost).',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 20,
        physical_loss_truth: 20,
        claimable_truth: 20,
        expected_value_status: 'full',
        rationale: 'Netting must aggregate across all legs.',
        events: [
            { id: 'g2-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G2', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'BULK', event_date: daysAgo(60), created_at: daysAgo(60) },
            { id: 'g2-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G2', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'BULK', event_date: daysAgo(50), created_at: daysAgo(50) },
            { id: 'g2-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G2', event_type: 'Transfer', quantity: -40, quantity_direction: 'out', reference_id: 'LEG-A', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 'g2-4', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G2', event_type: 'Transfer', quantity: -40, quantity_direction: 'out', reference_id: 'LEG-B', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 'g2-5', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G2', event_type: 'Transfer', quantity: 40, quantity_direction: 'in', reference_id: 'LEG-A', event_date: daysAgo(40), created_at: daysAgo(40) }
        ]
    },
    {
        scenario_id: 'G3-REBIN-CONFUSION',
        family: 'G: Multi-stage transfer ambiguity',
        description: 'Lost in FC1, then found in FC2.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Physical net wins.',
        events: [
            { id: 'g3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G3', event_type: 'Adjustment', quantity: -1, quantity_direction: 'out', reason: 'M', fulfillment_center_id: 'FC1', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'g3-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G3', event_type: 'Adjustment', quantity: 1, quantity_direction: 'in', reason: 'F', fulfillment_center_id: 'FC2', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'G4-IN-TRANSIT-OVERLAP',
        family: 'G: Multi-stage transfer ambiguity',
        description: 'Leg 1 Arrived, Leg 2 In-Transit.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Leg 2 is only 5 days old.',
        events: [
            { id: 'g4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G4', event_type: 'Transfer', quantity: -10, quantity_direction: 'out', reference_id: 'L1', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'g4-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G4', event_type: 'Transfer', quantity: 10, quantity_direction: 'in', reference_id: 'L1', event_date: daysAgo(35), created_at: daysAgo(35) },
            { id: 'g4-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-G4', event_type: 'Transfer', quantity: -10, quantity_direction: 'out', reference_id: 'L2', event_date: daysAgo(5), created_at: daysAgo(5) }
        ]
    },

    // --- FAMILY H: Financial-resolution confusion (4) ---
    {
        scenario_id: 'H1-PARTIALLY-REIMBURSED-LOST',
        family: 'H: Financial-resolution confusion',
        description: '10 lost, 4 reimbursed.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 6,
        physical_loss_truth: 10,
        claimable_truth: 6,
        expected_value_status: 'partial',
        rationale: 'Should detect remaining shortfall.',
        events: [
            { id: 'h1-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H1', event_type: 'Adjustment', quantity: -10, quantity_direction: 'out', reason: 'M', event_date: daysAgo(60), created_at: daysAgo(60) },
            { id: 'h1-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H1', event_type: 'Snapshot', quantity: 0, warehouse_balance: 0, quantity_direction: 'out', event_date: daysAgo(5), created_at: daysAgo(5) }
        ],
        financial_events: [
            { amazon_reimbursement_id: 'reimb-h1', fnsku: 'SKU-H1', quantity: 4, approval_date: daysAgo(30) }
        ]
    },
    {
        scenario_id: 'H2-REVERSED-REIMBURSEMENT',
        family: 'H: Financial-resolution confusion',
        description: '10 lost, 10 reimbursed, then 10 clawed back.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 10,
        physical_loss_truth: 10,
        claimable_truth: 10,
        expected_value_status: 'full',
        rationale: 'Clawback restores the claim eligibility.',
        events: [
            { id: 'h2-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H2', event_type: 'Adjustment', quantity: -10, quantity_direction: 'out', reason: 'M', event_date: daysAgo(60), created_at: daysAgo(60) }
        ],
        financial_events: [
            { amazon_reimbursement_id: 'reimb-h2', fnsku: 'SKU-H2', quantity: 10, approval_date: daysAgo(40) },
            { amazon_reimbursement_id: 'reimb-h2-claw', fnsku: 'SKU-H2', quantity: -10, approval_date: daysAgo(30) }
        ]
    },
    {
        scenario_id: 'H3-MISMATCHED-VALUE-CLAIM',
        family: 'H: Financial-resolution confusion',
        description: 'High value item vs low value settlement.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'If units net to 0, financial mismatch is a different problem.',
        events: [
            { id: 'h3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H3', event_type: 'Adjustment', quantity: -1, quantity_direction: 'out', reason: 'M', event_date: daysAgo(60), created_at: daysAgo(60) },
            { id: 'h3-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H3', event_type: 'Adjustment', quantity: 1, quantity_direction: 'in', reason: 'F', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    },
    {
        scenario_id: 'H4-GHOST-REIMBURSEMENT',
        family: 'H: Financial-resolution confusion',
        description: 'Reimbursement exists but item is physically found.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Should not claim if units are in warehouse.',
        events: [
            { id: 'h4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H4', event_type: 'Receipt', quantity: 10, quantity_direction: 'in', event_date: daysAgo(60), created_at: daysAgo(60) },
            { id: 'h4-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H4', event_type: 'Adjustment', quantity: -1, quantity_direction: 'out', reason: 'M', event_date: daysAgo(50), created_at: daysAgo(50) },
            { id: 'h4-3', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H4', event_type: 'Adjustment', quantity: 1, quantity_direction: 'in', reason: 'F', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'h4-4', seller_id: MOCK_SELLER_A, fnsku: 'SKU-H4', event_type: 'Snapshot', quantity: 10, warehouse_balance: 10, quantity_direction: 'in', event_date: daysAgo(5), created_at: daysAgo(5) }
        ],
        financial_events: [
            { amazon_reimbursement_id: 'reimb-h4', fnsku: 'SKU-H4', quantity: 1, approval_date: daysAgo(45) }
        ]
    },

    // --- FAMILY I: Temporal backfill stress (4) ---
    {
        scenario_id: 'I1-UNSORTED-CHAOS',
        family: 'I: Temporal backfill stress',
        description: 'Shipment recorded before Receipt.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Algorithm should sort by date internally.',
        events: [
            { id: 'i1-ship', seller_id: MOCK_SELLER_A, fnsku: 'SKU-I1', event_type: 'Shipment', quantity: -50, quantity_direction: 'out', event_date: daysAgo(20), created_at: daysAgo(20) },
            { id: 'i1-rcpt', seller_id: MOCK_SELLER_A, fnsku: 'SKU-I1', event_type: 'Receipt', quantity: 50, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) }
        ]
    },
    {
        scenario_id: 'I2-CREATED-AT-SKEW',
        family: 'I: Temporal backfill stress',
        description: 'Event date vs Created date disagree.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Forensic truth is event_date.',
        events: [
            { id: 'i2-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-I2', event_type: 'Adjustment', quantity: -1, quantity_direction: 'out', event_date: daysAgo(10), created_at: daysAgo(0) },
            { id: 'i2-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-I2', event_type: 'Adjustment', quantity: 1, quantity_direction: 'in', event_date: daysAgo(9), created_at: daysAgo(1) }
        ]
    },
    {
        scenario_id: 'I3-FUTURE-SYNC-LEAK',
        family: 'I: Temporal backfill stress',
        description: 'Events with future dates (Garbage).',
        expected_detector_outcome: 'suppressed',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'unknown',
        rationale: 'Safety protocols should ignore future-dated events.',
        events: [
            { id: 'i3-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-I3', event_type: 'Receipt', quantity: 100, quantity_direction: 'in', event_date: '2027-01-01', created_at: '2027-01-01' }
        ]
    },
    {
        scenario_id: 'I4-HISTORICAL-BACKFILL',
        family: 'I: Temporal backfill stress',
        description: '100 units from 2 years ago appear.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Should handle deep historical data if balanced.',
        events: [
            { id: 'i4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-I4', event_type: 'Receipt', quantity: 5, quantity_direction: 'in', event_date: '2022-01-01', created_at: '2022-01-01' },
            { id: 'i4-2', seller_id: MOCK_SELLER_A, fnsku: 'SKU-I4', event_type: 'Snapshot', quantity: 5, warehouse_balance: 5, quantity_direction: 'in', event_date: daysAgo(1), created_at: daysAgo(1) }
        ]
    },

    // --- FAMILY J: Multi-tenant separation (4) ---
    {
        scenario_id: 'J1-FNSKU-COLLISION',
        family: 'J: Multi-tenant separation',
        description: 'Seller A and Seller B use same FNSKU.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Logic must isolate by seller_id.',
        events: [
            { id: 'j1-a', seller_id: MOCK_SELLER_A, fnsku: 'SAME-FNSKU', event_type: 'Receipt', quantity: 10, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'j1-b', seller_id: MOCK_SELLER_B, fnsku: 'SAME-FNSKU', event_type: 'Receipt', quantity: 5, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) }
        ]
    },
    {
        scenario_id: 'J2-TENANT-LEAKAGE-ADJUSTMENT',
        family: 'J: Multi-tenant separation',
        description: 'Seller A loses 10, Seller B finds 10.',
        expected_detector_outcome: 'positive',
        expected_unresolved_units: 10,
        physical_loss_truth: 10,
        claimable_truth: 10,
        expected_value_status: 'full',
        rationale: 'Seller A still has a loss.',
        events: [
            { id: 'j2-a', seller_id: MOCK_SELLER_A, fnsku: 'X', event_type: 'Adjustment', quantity: -10, quantity_direction: 'out', reason: 'M', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'j2-b', seller_id: MOCK_SELLER_B, fnsku: 'X', event_type: 'Adjustment', quantity: 10, quantity_direction: 'in', reason: 'F', event_date: daysAgo(20), created_at: daysAgo(20) }
        ]
    },
    {
        scenario_id: 'J3-REF-ID-COLLISION',
        family: 'J: Multi-tenant separation',
        description: 'Same Transfer ID across tenants.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Seller isolation must hold.',
        events: [
            { id: 'j3-a', seller_id: MOCK_SELLER_A, fnsku: 'A', event_type: 'Transfer', reference_id: 'REF-1', quantity: -1, quantity_direction: 'out', event_date: daysAgo(10), created_at: daysAgo(10) },
            { id: 'j3-b', seller_id: MOCK_SELLER_B, fnsku: 'B', event_type: 'Transfer', reference_id: 'REF-1', quantity: 1, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) }
        ]
    },
    {
        scenario_id: 'J4-GLOBAL-SYNC-FLICKER',
        family: 'J: Multi-tenant separation',
        description: 'Mixed data sync for multiple sellers.',
        expected_detector_outcome: 'negative',
        expected_unresolved_units: 0,
        physical_loss_truth: 0,
        claimable_truth: 0,
        expected_value_status: 'zero',
        rationale: 'Detector entrypoint takes sellerId, so it should filter correctly.',
        events: [
            { id: 'j4-1', seller_id: MOCK_SELLER_A, fnsku: 'SKU-J4', event_type: 'Receipt', quantity: 10, quantity_direction: 'in', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'j4-2', seller_id: 'ANY-OTHER', fnsku: 'SKU-J4', event_type: 'Shipment', quantity: -10, quantity_direction: 'out', event_date: daysAgo(10), created_at: daysAgo(10) }
        ]
    }
];
