/**
 * Transfer Loss Adversarial Scenario Library
 * 
 * Version: 1.0 (Production-Grade)
 */

import { InventoryLedgerEvent } from '../services/detection/core/detectors/inventoryAlgorithms';
import { TransferRecord } from '../services/detection/core/detectors/warehouseTransferLossAlgorithm';

export interface TransferLossScenario {
    id: string;
    family: string;
    description: string;
    outcome: 'positive' | 'negative' | 'suppressed';
    
    // Quantitative Ground Truth
    expected_sent_units: number;
    expected_received_units: number;
    expected_unresolved_units: number;
    expected_claimable_units: number;

    rationale: string;
    
    // Inputs
    events: InventoryLedgerEvent[]; // For Path B (Forensic)
    transfer_records: TransferRecord[]; // For Path A (Shallow)
    financial_events?: any[];
}

const MOCK_SELLER = 'seller-tl-1';

const daysAgo = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
};

export const TRANSFER_LOSS_SCENARIOS: TransferLossScenario[] = [
    // --- Family 1: Healthy Transfers (5) ---
    {
        id: 'H1-STANDARD-FLOW',
        family: '1: Healthy transfers',
        description: 'Standard Transfer: Sent 100, Received 100 within 10 days.',
        outcome: 'negative',
        expected_sent_units: 100, expected_received_units: 100, expected_unresolved_units: 0, expected_claimable_units: 0,
        rationale: 'Balanced transfer within SLA.',
        events: [
            { id: 'h1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-H1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-H1', event_date: daysAgo(20), created_at: daysAgo(20) },
            { id: 'h1-2', seller_id: MOCK_SELLER, fnsku: 'SKU-H1', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'X-H1', event_date: daysAgo(10), created_at: daysAgo(10) }
        ],
        transfer_records: [
            { id: 'tr-h1', seller_id: MOCK_SELLER, transfer_id: 'X-H1', sku: 'SKU-H1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(20), quantity_sent: 100, quantity_received: 100, quantity_missing: 0, transfer_status: 'received', days_in_transit: 10, unit_value: 20, currency: 'USD' }
        ]
    },
    {
        id: 'H2-QUICK-RECON',
        family: '1: Healthy transfers',
        description: 'Sent 50, Received 50 next day.',
        outcome: 'negative',
        expected_sent_units: 50, expected_received_units: 50, expected_unresolved_units: 0, expected_claimable_units: 0,
        rationale: 'Immediate resolution.',
        events: [
            { id: 'h2-1', seller_id: MOCK_SELLER, fnsku: 'SKU-H2', event_type: 'Transfer', quantity: -50, quantity_direction: 'out', reference_id: 'X-H2', event_date: daysAgo(5), created_at: daysAgo(5) },
            { id: 'h2-2', seller_id: MOCK_SELLER, fnsku: 'SKU-H2', event_type: 'Transfer', quantity: 50, quantity_direction: 'in', reference_id: 'X-H2', event_date: daysAgo(4), created_at: daysAgo(4) }
        ],
        transfer_records: [
            { id: 'tr-h2', seller_id: MOCK_SELLER, transfer_id: 'X-H2', sku: 'SKU-H2', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(5), quantity_sent: 50, quantity_received: 50, quantity_missing: 0, transfer_status: 'received', days_in_transit: 1, unit_value: 20, currency: 'USD' }
        ]
    },
    // ... adding more families ...
    // --- Family 2: True Loss (5) ---
    {
        id: 'L1-GHOST-TRANSFER',
        family: '2: True transfer loss',
        description: 'Sent 100 units 45 days ago, 0 received.',
        outcome: 'positive',
        expected_sent_units: 100, expected_received_units: 0, expected_unresolved_units: 100, expected_claimable_units: 100,
        rationale: 'Past 30-day SLA with zero reconciliation.',
        events: [
            { id: 'l1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-L1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-L1', event_date: daysAgo(45), created_at: daysAgo(45) }
        ],
        transfer_records: [
            { id: 'tr-l1', seller_id: MOCK_SELLER, transfer_id: 'X-L1', sku: 'SKU-L1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 0, quantity_missing: 100, transfer_status: 'in_transit', days_in_transit: 45, unit_value: 20, currency: 'USD' }
        ]
    },
    {
        id: 'L2-PARTIAL-GHOST',
        family: '2: True transfer loss',
        description: 'Sent 100 units 45 days ago, only 60 received.',
        outcome: 'positive',
        expected_sent_units: 100, expected_received_units: 60, expected_unresolved_units: 40, expected_claimable_units: 40,
        rationale: 'Partial loss confirmed after SLA expiration.',
        events: [
            { id: 'l2-1', seller_id: MOCK_SELLER, fnsku: 'SKU-L2', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-L2', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 'l2-2', seller_id: MOCK_SELLER, fnsku: 'SKU-L2', event_type: 'Transfer', quantity: 60, quantity_direction: 'in', reference_id: 'X-L2', event_date: daysAgo(35), created_at: daysAgo(35) }
        ],
        transfer_records: [
            { id: 'tr-l2', seller_id: MOCK_SELLER, transfer_id: 'X-L2', sku: 'SKU-L2', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 60, quantity_missing: 40, transfer_status: 'partial', days_in_transit: 45, unit_value: 20, currency: 'USD' }
        ]
    },
    // --- Family 3: Partial Receipts (4) ---
    {
        id: 'P1-MULTI-LEG-RECON',
        family: '3: Partial receipts',
        description: '100 sent, receipts arriving in chunks. 20 missing after 45 days.',
        outcome: 'positive',
        expected_sent_units: 100, expected_received_units: 80, expected_unresolved_units: 20, expected_claimable_units: 20,
        rationale: 'Aggregated receipts still leave 20 units missing.',
        events: [
            { id: 'p1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-P1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-P1', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 'p1-2', seller_id: MOCK_SELLER, fnsku: 'SKU-P1', event_type: 'Transfer', quantity: 40, quantity_direction: 'in', reference_id: 'X-P1', event_date: daysAgo(35), created_at: daysAgo(35) },
            { id: 'p1-3', seller_id: MOCK_SELLER, fnsku: 'SKU-P1', event_type: 'Transfer', quantity: 40, quantity_direction: 'in', reference_id: 'X-P1', event_date: daysAgo(30), created_at: daysAgo(30) }
        ],
        transfer_records: [
            { id: 'tr-p1', seller_id: MOCK_SELLER, transfer_id: 'X-P1', sku: 'SKU-P1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 80, quantity_missing: 20, transfer_status: 'partial', days_in_transit: 45, unit_value: 20, currency: 'USD' }
        ]
    },
    // --- Family 4: Split Receipts (4) ---
    {
        id: 'S1-LONG-TAIL-ARRIVAL',
        family: '4: Split receipts across multiple dates',
        description: '100 sent, 90 arrived Day 31, 10 still missing at Day 45.',
        outcome: 'positive',
        expected_sent_units: 100, expected_received_units: 90, expected_unresolved_units: 10, expected_claimable_units: 10,
        rationale: 'Late arrival covers most but not all units.',
        events: [
            { id: 's1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-S1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-S1', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 's1-2', seller_id: MOCK_SELLER, fnsku: 'SKU-S1', event_type: 'Transfer', quantity: 90, quantity_direction: 'in', reference_id: 'X-S1', event_date: daysAgo(14), created_at: daysAgo(14) }
        ],
        transfer_records: [
            { id: 'tr-s1', seller_id: MOCK_SELLER, transfer_id: 'X-S1', sku: 'SKU-S1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 90, quantity_missing: 10, transfer_status: 'partial', days_in_transit: 45, unit_value: 20, currency: 'USD' }
        ]
    },
    // --- Family 5: Boundary Maturity (5) ---
    {
        id: 'B1-WINDOW-DAY-29',
        family: '5: Boundary maturity cases',
        description: 'Sent 100 units 29 days ago. Outcome should be suppressed/negative.',
        outcome: 'suppressed',
        expected_sent_units: 100, expected_received_units: 0, expected_unresolved_units: 0, expected_claimable_units: 0,
        rationale: 'Within 30-day maturity window.',
        events: [
            { id: 'b1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-B1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-B1', event_date: daysAgo(29), created_at: daysAgo(29) }
        ],
        transfer_records: [
            { id: 'tr-b1', seller_id: MOCK_SELLER, transfer_id: 'X-B1', sku: 'SKU-B1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(29), quantity_sent: 100, quantity_received: 0, quantity_missing: 100, transfer_status: 'in_transit', days_in_transit: 29, unit_value: 20, currency: 'USD' }
        ]
    },
    {
        id: 'B2-WINDOW-DAY-31',
        family: '5: Boundary maturity cases',
        description: 'Sent 100 units 31 days ago. Outcome should be positive.',
        outcome: 'positive',
        expected_sent_units: 100, expected_received_units: 0, expected_unresolved_units: 100, expected_claimable_units: 100,
        rationale: 'Past 30-day maturity window.',
        events: [
            { id: 'b2-1', seller_id: MOCK_SELLER, fnsku: 'SKU-B2', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-B2', event_date: daysAgo(31), created_at: daysAgo(31) }
        ],
        transfer_records: [
            { id: 'tr-b2', seller_id: MOCK_SELLER, transfer_id: 'X-B2', sku: 'SKU-B2', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(31), quantity_sent: 100, quantity_received: 0, quantity_missing: 100, transfer_status: 'in_transit', days_in_transit: 31, unit_value: 20, currency: 'USD' }
        ]
    },
    // --- Family 6: Missing Reference IDs (3) ---
    {
        id: 'M1-ORPHAN-LEG',
        family: '6: Missing or remapped reference IDs',
        description: 'Sent with ID X, received without ID. Should stay negative.',
        outcome: 'negative',
        expected_sent_units: 100, expected_received_units: 100, expected_unresolved_units: 0, expected_claimable_units: 0,
        rationale: 'Quantity balance should overcome ID missingness (Path B feature). Path A will fail.',
        events: [
            { id: 'm1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-M1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-M1', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'm1-2', seller_id: MOCK_SELLER, fnsku: 'SKU-M1', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: '', event_date: daysAgo(35), created_at: daysAgo(35) }
        ],
        transfer_records: [] // Path A cannot even see entries without IDs in some ingestions
    },
    // --- Family 7: Multi-hop FC Transfers (4) ---
    {
        id: 'H1-HUB-REDISTRIBUTION',
        family: '7: Multi-hop FC transfers',
        description: 'Sent 100 to HUB. Sent 100 out of HUB. Arrived 80 at FINAL. 20 lost.',
        outcome: 'positive',
        expected_sent_units: 100, expected_received_units: 80, expected_unresolved_units: 20, expected_claimable_units: 20,
        rationale: 'End-to-end tally across FC legs.',
        events: [
            { id: 'gh1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-GH1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'TRUNK-1', fulfillment_center_id: 'ORIGIN', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 'gh1-2', seller_id: MOCK_SELLER, fnsku: 'SKU-GH1', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'TRUNK-1', fulfillment_center_id: 'HUB', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'gh1-3', seller_id: MOCK_SELLER, fnsku: 'SKU-GH1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'LEG-A', fulfillment_center_id: 'HUB', event_date: daysAgo(38), created_at: daysAgo(38) },
            { id: 'gh1-4', seller_id: MOCK_SELLER, fnsku: 'SKU-GH1', event_type: 'Transfer', quantity: 80, quantity_direction: 'in', reference_id: 'LEG-A', fulfillment_center_id: 'FINAL', event_date: daysAgo(35), created_at: daysAgo(35) }
        ],
        transfer_records: [
            { id: 'tr-gh1', seller_id: MOCK_SELLER, transfer_id: 'TRUNK-1', sku: 'SKU-GH1', source_fc: 'ORIGIN', destination_fc: 'HUB', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 100, quantity_missing: 0, transfer_status: 'received', days_in_transit: 5, unit_value: 20, currency: 'USD' },
            { id: 'tr-gh2', seller_id: MOCK_SELLER, transfer_id: 'LEG-A', sku: 'SKU-GH1', source_fc: 'HUB', destination_fc: 'FINAL', transfer_date: daysAgo(38), quantity_sent: 100, quantity_received: 80, quantity_missing: 20, transfer_status: 'partial', days_in_transit: 5, unit_value: 20, currency: 'USD' }
        ]
    },
    // --- Family 8: Duplicate Contamination (3) ---
    {
        id: 'D1-LEDGER-DUPE',
        family: '8: Duplicate event contamination',
        description: 'One sent event appears twice in ledger (duplicate ID or fingerprint).',
        outcome: 'negative',
        expected_sent_units: 100, expected_received_units: 100, expected_unresolved_units: 0, expected_claimable_units: 0,
        rationale: 'Deduplication must prevent artificial loss detections.',
        events: [
            { id: 'd1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-D1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-D1', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'd1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-D1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-D1', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'd1-2', seller_id: MOCK_SELLER, fnsku: 'SKU-D1', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'X-D1', event_date: daysAgo(35), created_at: daysAgo(35) }
        ],
        transfer_records: [
            { id: 'tr-d1', seller_id: MOCK_SELLER, transfer_id: 'X-D1', sku: 'SKU-D1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(40), quantity_sent: 100, quantity_received: 100, quantity_missing: 0, transfer_status: 'received', days_in_transit: 5, unit_value: 20, currency: 'USD' }
        ]
    },
    // --- Family 9: Reimbursement Interactions (3) ---
    {
        id: 'R1-POST-REIMBURSE',
        family: '9: Reimbursement interactions',
        description: '100 lost, but 100 reimbursed already.',
        outcome: 'negative',
        expected_sent_units: 100, expected_received_units: 0, expected_unresolved_units: 0, expected_claimable_units: 0,
        rationale: 'Financial reconciliation nets the loss.',
        events: [
            { id: 'r1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-R1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-R1', event_date: daysAgo(45), created_at: daysAgo(45), fulfillment_center_id: 'FC1' }
        ],
        transfer_records: [
            { id: 'tr-r1', seller_id: MOCK_SELLER, transfer_id: 'X-R1', sku: 'SKU-R1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 0, quantity_missing: 100, transfer_status: 'lost', days_in_transit: 45, unit_value: 20, currency: 'USD' }
        ],
        financial_events: [
            { seller_id: MOCK_SELLER, fnsku: 'SKU-R1', quantity: 100, approval_date: daysAgo(35), reason: 'LostInTransit', fulfillment_center_id: 'FC1' }
        ]
    },
    // --- Family 10: Cross-tenant Collisions (2) ---
    {
        id: 'T1-TENANT-ISOLATION',
        family: '10: Cross-tenant collisions',
        description: 'Seller A loses 100. Seller B has healthy 100. Entrypoint is Seller A.',
        outcome: 'positive',
        expected_sent_units: 100, expected_received_units: 0, expected_unresolved_units: 100, expected_claimable_units: 100,
        rationale: 'Must not leak data from other sellers.',
        events: [
            { id: 't1-a', seller_id: 'SELLER-A', fnsku: 'SHARED-SKU', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-A', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 't1-b1', seller_id: 'SELLER-B', fnsku: 'SHARED-SKU', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-B', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 't1-b2', seller_id: 'SELLER-B', fnsku: 'SHARED-SKU', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'X-B', event_date: daysAgo(35), created_at: daysAgo(35) }
        ],
        transfer_records: [
            { id: 'tr-t1a', seller_id: 'SELLER-A', transfer_id: 'X-A', sku: 'SHARED-SKU', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 0, quantity_missing: 100, transfer_status: 'lost', days_in_transit: 45, unit_value: 20, currency: 'USD' },
            { id: 'tr-t1b', seller_id: 'SELLER-B', transfer_id: 'X-B', sku: 'SHARED-SKU', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 100, quantity_missing: 0, transfer_status: 'received', days_in_transit: 10, unit_value: 20, currency: 'USD' }
        ]
    },
    // --- Family 11: Freshness Suppression (2) ---
    {
        id: 'F1-RECENT-TRANSFER',
        family: '11: Fresh but unresolved transfers that should suppress',
        description: 'Sent 100 units 2 hours ago. 0 received.',
        outcome: 'suppressed',
        expected_sent_units: 100, expected_received_units: 0, expected_unresolved_units: 0, expected_claimable_units: 0,
        rationale: 'Too recent for detection.',
        events: [
            { id: 'f1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-F1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'X-F1', event_date: daysAgo(0.01), created_at: daysAgo(0.01) }
        ],
        transfer_records: [
            { id: 'tr-f1', seller_id: MOCK_SELLER, transfer_id: 'X-F1', sku: 'SKU-F1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(0.01), quantity_sent: 100, quantity_received: 0, quantity_missing: 100, transfer_status: 'in_transit', days_in_transit: 0, unit_value: 20, currency: 'USD' }
        ]
    },
    // --- Family 12: Ambiguous Competing Matches (2) ---
    {
        id: 'A1-ID-COLLISION',
        family: '12: Ambiguous competing matches',
        description: 'Two separate transfers use same Reference ID (unlikely but possible).',
        outcome: 'positive',
        expected_sent_units: 200, expected_received_units: 100, expected_unresolved_units: 100, expected_claimable_units: 100,
        rationale: 'Quantity aggregation should correctly identify 100 missing.',
        events: [
            { id: 'a1-1', seller_id: MOCK_SELLER, fnsku: 'SKU-A1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'DUPE-ID', event_date: daysAgo(45), created_at: daysAgo(45) },
            { id: 'a1-2', seller_id: MOCK_SELLER, fnsku: 'SKU-A1', event_type: 'Transfer', quantity: -100, quantity_direction: 'out', reference_id: 'DUPE-ID', event_date: daysAgo(40), created_at: daysAgo(40) },
            { id: 'a1-3', seller_id: MOCK_SELLER, fnsku: 'SKU-A1', event_type: 'Transfer', quantity: 100, quantity_direction: 'in', reference_id: 'DUPE-ID', event_date: daysAgo(35), created_at: daysAgo(35) }
        ],
        transfer_records: [
            { id: 'tr-a1', seller_id: MOCK_SELLER, transfer_id: 'DUPE-ID', sku: 'SKU-A1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(45), quantity_sent: 100, quantity_received: 50, quantity_missing: 50, transfer_status: 'partial', days_in_transit: 45, unit_value: 20, currency: 'USD' },
            { id: 'tr-a2', seller_id: MOCK_SELLER, transfer_id: 'DUPE-ID', sku: 'SKU-A1', source_fc: 'FC1', destination_fc: 'FC2', transfer_date: daysAgo(40), quantity_sent: 100, quantity_received: 50, quantity_missing: 50, transfer_status: 'partial', days_in_transit: 40, unit_value: 20, currency: 'USD' }
        ]
    }
];
