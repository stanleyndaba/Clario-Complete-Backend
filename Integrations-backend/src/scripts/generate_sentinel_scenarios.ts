import * as fs from 'fs';
import * as path from 'path';

export type SentinelAnomalyType = 'missed_reimbursement' | 'duplicate_reimbursement' | 'clawback_risk' | 'ASYMMETRIC_CLAWBACK' | 'GHOST_REVERSAL';

export interface SentinelScenario {
    id: string;
    description: string;
    family: string;
    data: any;
    expected_results: {
        has_anomaly: boolean;
        expected_anomaly_count?: number;
        expected_detection_types?: SentinelAnomalyType[];
        expected_value_delta?: number;
    };
}

const scenarios: SentinelScenario[] = [];

// Helper
const L = (id: string, qty: number, val: number, ref?: { order_id?: string; case_id?: string; sku?: string; seller_id?: string }) => ({
    id,
    seller_id: ref?.seller_id || 'SELLER_1',
    event_type: 'lost',
    event_date: '2025-01-01',
    sku: ref?.sku || 'SKU-A',
    quantity: qty,
    estimated_value: val,
    currency: 'USD',
    source: 'inventory_ledger',
    order_id: ref?.order_id
});

const R = (id: string, qty: number, amt: number, ref?: { order_id?: string; case_id?: string; sku?: string; seller_id?: string }) => ({
    id,
    seller_id: ref?.seller_id || 'SELLER_1',
    reimbursement_date: '2025-01-05',
    sku: ref?.sku || 'SKU-A',
    quantity: qty,
    amount: amt,
    currency: 'USD',
    order_id: ref?.order_id,
    case_id: ref?.case_id
});

// R1 — Partial reimbursement chains
for (let i=1; i<=6; i++) {
    const isMissed = i <= 3;
    scenarios.push({
        id: `R1-PARTIAL-0${i}`,
        description: `Partial chain: 10 units loss, reimbursed 4 + ${isMissed ? 4 : 6} units`,
        family: 'R1-Partial-Chains',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [L(`L${i}`, 10, 100, { order_id: `O-R1-${i}` })],
            reimbursement_events: [
                R(`R${i}a`, 4, 40, { order_id: `O-R1-${i}` }),
                R(`R${i}b`, isMissed ? 4 : 6, isMissed ? 40 : 60, { order_id: `O-R1-${i}` })
            ]
        },
        expected_results: {
            has_anomaly: isMissed,
            expected_detection_types: isMissed ? ['missed_reimbursement'] : [],
            expected_value_delta: isMissed ? 20 : 0
        }
    });
}

// R2 — Out-of-order reimbursements
for (let i=1; i<=6; i++) {
    const isDup = i > 3;
    scenarios.push({
        id: `R2-OUT-OF-ORDER-0${i}`,
        description: `Loss and Reimb with scrambled dates.`,
        family: 'R2-Out-of-Order',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [
                { ...L(`L${i}`, 1, 20, { order_id: `O-R2-${i}` }), event_date: '2025-02-01' }
            ],
            reimbursement_events: [
                { ...R(`R${i}a`, 1, 20, { order_id: `O-R2-${i}` }), reimbursement_date: '2025-01-15' }
            ].concat(isDup ? [{ ...R(`R${i}b`, 1, 20, { order_id: `O-R2-${i}` }), reimbursement_date: '2025-02-15' }] : [])
        },
        expected_results: {
            has_anomaly: isDup,
            expected_detection_types: isDup ? ['duplicate_reimbursement'] : [],
            expected_value_delta: isDup ? 20 : 0
        }
    });
}

// R3 — Delayed reimbursements (>90 days)
for (let i=1; i<=6; i++) {
    const isMissed = i > 3;
    scenarios.push({
        id: `R3-DELAYED-0${i}`,
        description: `Over 90 days delay between loss and reimbursement.`,
        family: 'R3-Delayed-Reimbursements',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [{ ...L(`L${i}`, 1, 20, { order_id: `O-R3-${i}` }), event_date: '2025-01-01' }],
            reimbursement_events: isMissed ? [] : [
                { ...R(`R${i}a`, 1, 20, { order_id: `O-R3-${i}` }), reimbursement_date: '2025-05-01' } // 120 days later
            ]
        },
        expected_results: {
            has_anomaly: isMissed,
            expected_detection_types: isMissed ? ['missed_reimbursement'] : [],
            expected_value_delta: isMissed ? 20 : 0
        }
    });
}

// R4 — Duplicate reimbursements
for (let i=1; i<=6; i++) {
    scenarios.push({
        id: `R4-DUPLICATE-0${i}`,
        description: `Order refunded multiple times securely tracking same ID.`,
        family: 'R4-Duplicate-Reimbursements',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [L(`L${i}`, 2, 50, { order_id: `O-R4-${i}` })],
            reimbursement_events: [
                R(`R${i}a`, 2, 50, { order_id: `O-R4-${i}` }),
                R(`R${i}b`, 2, 50, { order_id: `O-R4-${i}` })
            ]
        },
        expected_results: {
            has_anomaly: true,
            expected_detection_types: ['duplicate_reimbursement'],
            expected_value_delta: 50
        }
    });
}

// R5 — Reversal lineage chains
for (let i=1; i<=6; i++) {
    const isGhost = i <= 2;
    const isAsym = i === 3 || i === 4;
    const isClean = i >= 5;
    
    let reimbursements = [];
    if (isGhost) {
        reimbursements = [
            R(`R${i}a`, 1, 25, { order_id: `O-R5-${i}` }),
            R(`R${i}b`, -1, -25, { order_id: `O-R5-${i}` })
        ];
    } else if (isAsym) {
        reimbursements = [
            R(`R${i}a`, 1, 25, { order_id: `O-R5-${i}` }),
            R(`R${i}b`, -1, -50, { order_id: `O-R5-${i}` }) // clawed back more
        ];
    } else {
        reimbursements = [
            R(`R${i}a`, 1, 25, { order_id: `O-R5-${i}` }),
            R(`R${i}b`, -1, -25, { order_id: `O-R5-${i}` }),
            R(`R${i}c`, 1, 25, { order_id: `O-R5-${i}` }) // re-reimbursed
        ];
    }
    
    scenarios.push({
        id: `R5-REVERSAL-0${i}`,
        description: `Reversal tracking chains. Ghost: ${isGhost}, Asym: ${isAsym}, Clean: ${isClean}`,
        family: 'R5-Reversal-Lineage',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [L(`L${i}`, 1, 25, { order_id: `O-R5-${i}` })],
            reimbursement_events: reimbursements
        },
        expected_results: {
            has_anomaly: isGhost || isAsym,
            expected_detection_types: isGhost ? ['GHOST_REVERSAL'] : (isAsym ? ['ASYMMETRIC_CLAWBACK'] : []),
            expected_value_delta: isGhost ? 25 : (isAsym ? 25 : 0) // Asymmetric clawback is $25 delta (50 reversed - 25 orig)
        }
    });
}

// R6 — Multi-SKU reimbursements under the same order_id
for (let i=1; i<=6; i++) {
    const isMissed = i > 3;
    scenarios.push({
        id: `R6-MULTI-SKU-0${i}`,
        description: `Multiple SKUs identically lost under one order.`,
        family: 'R6-Multi-SKU-Order',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [
                L(`L${i}a`, 1, 10, { order_id: `O-R6-${i}`, sku: 'SKU-A' }),
                L(`L${i}b`, 1, 20, { order_id: `O-R6-${i}`, sku: 'SKU-B' })
            ],
            reimbursement_events: [
                R(`R${i}a`, 1, 10, { order_id: `O-R6-${i}`, sku: 'SKU-A' })
            ].concat(isMissed ? [] : [R(`R${i}b`, 1, 20, { order_id: `O-R6-${i}`, sku: 'SKU-B' })])
        },
        expected_results: {
            has_anomaly: isMissed,
            expected_detection_types: isMissed ? ['missed_reimbursement'] : [],
            expected_value_delta: isMissed ? 20 : 0
        }
    });
}

// R7 — Cross-tenant identifier collisions
for (let i=1; i<=6; i++) {
    scenarios.push({
        id: `R7-CROSS-TENANT-0${i}`,
        description: `Same Order ID across two tenants shouldn't leak.`,
        family: 'R7-Cross-Tenant-Collisions',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [L(`L${i}`, 1, 30, { order_id: `O-R7-${i}`, seller_id: 'SELLER_1' })],
            reimbursement_events: [
                R(`R${i}a`, 1, 30, { order_id: `O-R7-${i}`, seller_id: 'SELLER_2' }) // Different seller ID
            ]
        },
        expected_results: {
            has_anomaly: true, // For SELLER_1, the loss is completely unmatched.
            expected_detection_types: ['missed_reimbursement'],
            expected_value_delta: 30
        }
    });
}

// R8 — Settlement fragmentation
for (let i=1; i<=6; i++) {
    scenarios.push({
        id: `R8-SETTLEMENT-FRAG-0${i}`,
        description: `Loss and Reimbursement spanning huge gaps conceptually distinct settlements.`,
        family: 'R8-Settlement-Fragmentation',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [{ ...L(`L${i}`, 1, 15, { order_id: `O-R8-${i}` }), event_date: '2024-01-01' }],
            reimbursement_events: [{ ...R(`R${i}a`, 1, 15, { order_id: `O-R8-${i}` }), reimbursement_date: '2025-12-01' }]
        },
        expected_results: {
            has_anomaly: false,
            expected_detection_types: [],
            expected_value_delta: 0
        }
    });
}

// R9 — Orphan reimbursements
for (let i=1; i<=6; i++) {
    scenarios.push({
        id: `R9-ORPHAN-0${i}`,
        description: `Reimbursement with zero causality trace.`,
        family: 'R9-Orphan-Reimbursements',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [],
            reimbursement_events: [R(`R${i}a`, 1, 45, { order_id: `O-R9-${i}` })]
        },
        expected_results: {
            has_anomaly: true,
            expected_detection_types: ['clawback_risk'], // orphans are clawback risks
            expected_value_delta: 45
        }
    });
}

// R10 — Residual rounding edge cases around EPSILON = 0.05
for (let i=1; i<=6; i++) {
    const isAnomaly = i > 3; // > $0.05
    const amt = isAnomaly ? 9.90 : 9.97; // 10.00 expected - 9.90 = 0.10 anomaly. 10.00 - 9.97 = 0.03 noise.
    scenarios.push({
        id: `R10-EPSILON-0${i}`,
        description: `Rounding noise vs real shortfall.`,
        family: 'R10-Residual-Epsilon',
        data: {
            seller_id: 'SELLER_1', sync_id: 'SYNC_1',
            loss_events: [L(`L${i}`, 1, 10.00, { order_id: `O-R10-${i}` })],
            reimbursement_events: [R(`R${i}a`, 1, amt, { order_id: `O-R10-${i}` })]
        },
        expected_results: {
            has_anomaly: isAnomaly,
            expected_detection_types: isAnomaly ? ['missed_reimbursement'] : [],
            expected_value_delta: isAnomaly ? 0.10 : 0
        }
    });
}

// --- Paired Guard Scenarios (Hardening Round 3) ---

// Guard for R2 (Out-of-Order Mappings)
scenarios.push({
    id: `GUARD-R2-DETECT`,
    description: `Detect scrambled chronology duplicate.`,
    family: 'R2-Out-of-Order',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [ { ...L('G-L2', 1, 20, { order_id: 'O-G-2' }), event_date: '2025-02-01' } ], reimbursement_events: [ { ...R('G-R2a', 1, 20, { order_id: 'O-G-2' }), reimbursement_date: '2025-01-15' }, { ...R('G-R2b', 1, 20, { order_id: 'O-G-2' }), reimbursement_date: '2025-02-15' } ] },
    expected_results: { has_anomaly: true, expected_detection_types: ['duplicate_reimbursement'], expected_value_delta: 20 }
});
scenarios.push({
    id: `GUARD-R2-SUPPRESS`,
    description: `Suppress normal Out-of-Order 1:1 reimbursement.`,
    family: 'R2-Out-of-Order',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [ { ...L('G-L2s', 1, 20, { order_id: 'O-G-2s' }), event_date: '2025-02-01' } ], reimbursement_events: [ { ...R('G-R2s', 1, 20, { order_id: 'O-G-2s' }), reimbursement_date: '2025-01-15' } ] },
    expected_results: { has_anomaly: false, expected_detection_types: [], expected_value_delta: 0 }
});

// Guard for R4 (Exact Duplicate Over Long Time Boundaries)
scenarios.push({
    id: `GUARD-R4-DETECT`,
    description: `Duplicate over 2 years.`,
    family: 'R4-Duplicate-Reimbursements',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [ L('G-L4', 1, 50, { order_id: 'O-G-4' }) ], reimbursement_events: [ { ...R('G-R4a', 1, 50, { order_id: 'O-G-4' }), reimbursement_date: '2023-01-01' }, { ...R('G-R4b', 1, 50, { order_id: 'O-G-4' }), reimbursement_date: '2025-01-01' } ] },
    expected_results: { has_anomaly: true, expected_detection_types: ['duplicate_reimbursement'], expected_value_delta: 50 }
});
scenarios.push({
    id: `GUARD-R4-SUPPRESS`,
    description: `Suppress valid staggered partial chunks across long boundary.`,
    family: 'R4-Duplicate-Reimbursements',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [ L('G-L4s', 2, 100, { order_id: 'O-G-4s' }) ], reimbursement_events: [ { ...R('G-R4sa', 1, 50, { order_id: 'O-G-4s' }), reimbursement_date: '2023-01-01' }, { ...R('G-R4sb', 1, 50, { order_id: 'O-G-4s' }), reimbursement_date: '2025-01-01' } ] },
    expected_results: { has_anomaly: false, expected_detection_types: [], expected_value_delta: 0 }
});

// Guard for R7 (Cross Tenant Leakage)
scenarios.push({
    id: `GUARD-R7-DETECT`,
    description: `Detect missed due to isolation.`,
    family: 'R7-Cross-Tenant-Collisions',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [ L('G-L7', 1, 30, { order_id: 'O-G-7', seller_id: 'SELLER_1' }) ], reimbursement_events: [ R('G-R7a', 1, 30, { order_id: 'O-G-7', seller_id: 'SELLER_2' }) ] },
    expected_results: { has_anomaly: true, expected_detection_types: ['missed_reimbursement'], expected_value_delta: 30 }
});
scenarios.push({
    id: `GUARD-R7-SUPPRESS`,
    description: `Suppress when tenant isolation explicitly succeeds.`,
    family: 'R7-Cross-Tenant-Collisions',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [ L('G-L7s', 1, 30, { order_id: 'O-G-7s', seller_id: 'SELLER_1' }) ], reimbursement_events: [ R('G-R7sa', 1, 30, { order_id: 'O-G-7s', seller_id: 'SELLER_1' }) ] },
    expected_results: { has_anomaly: false, expected_detection_types: [], expected_value_delta: 0 }
});

// Guard for R9 (Orphan Emission)
scenarios.push({
    id: `GUARD-R9-DETECT`,
    description: `Detect strict orphan.`,
    family: 'R9-Orphan-Reimbursements',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [], reimbursement_events: [ R('G-R9', 1, 60, { order_id: 'O-G-9' }) ] },
    expected_results: { has_anomaly: true, expected_detection_types: ['clawback_risk'], expected_value_delta: 60 }
});
scenarios.push({
    id: `GUARD-R9-SUPPRESS`,
    description: `Suppress zero amount orphan.`,
    family: 'R9-Orphan-Reimbursements',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [], reimbursement_events: [ R('G-R9s', 1, 0, { order_id: 'O-G-9s' }) ] },
    expected_results: { has_anomaly: false, expected_detection_types: [], expected_value_delta: 0 }
});

// Guard for R10 (Epsilon Arbitration)
scenarios.push({
    id: `GUARD-R10-DETECT`,
    description: `Detect anomaly > Epsilon.`,
    family: 'R10-Residual-Epsilon',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [ L('G-L10', 1, 10.00, { order_id: 'O-G-10' }) ], reimbursement_events: [ R('G-R10', 1, 9.90, { order_id: 'O-G-10' }) ] },
    expected_results: { has_anomaly: true, expected_detection_types: ['missed_reimbursement'], expected_value_delta: 0.10 }
});
scenarios.push({
    id: `GUARD-R10-SUPPRESS`,
    description: `Suppress anomaly <= Epsilon noise.`,
    family: 'R10-Residual-Epsilon',
    data: { seller_id: 'SELLER_1', sync_id: 'SYNC_1', loss_events: [ L('G-L10s', 1, 10.00, { order_id: 'O-G-10s' }) ], reimbursement_events: [ R('G-R10s', 1, 9.97, { order_id: 'O-G-10s' }) ] },
    expected_results: { has_anomaly: false, expected_detection_types: [], expected_value_delta: 0 }
});

const fileContent = `import { SentinelSyncedData, LossEvent, ReimbursementEvent } from '../services/detection/algorithms/duplicateMissedReimbursementAlgorithm';

export type SentinelAnomalyType = 'missed_reimbursement' | 'duplicate_reimbursement' | 'clawback_risk' | 'ASYMMETRIC_CLAWBACK' | 'GHOST_REVERSAL';

export interface SentinelScenario {
    id: string;
    description: string;
    family: string;
    data: SentinelSyncedData;
    expected_results: {
        has_anomaly: boolean;
        expected_anomaly_count?: number;
        expected_detection_types?: SentinelAnomalyType[];
        expected_value_delta?: number;
    };
}

export const SENTINEL_LAB_SCENARIOS: SentinelScenario[] = ${JSON.stringify(scenarios, null, 4)};
`;

fs.writeFileSync(path.join('c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/scripts', 'sentinel_scenarios.ts'), fileContent);
console.log('Successfully generated 60 scenarios in sentinel_scenarios.ts');
