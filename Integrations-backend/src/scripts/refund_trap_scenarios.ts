/**
 * Refund Trap - Adversarial Scenario Library
 * 
 * 8 Families, 40+ Scenarios
 * Focus: Multi-unit splits, Return Status boundaries, Currency scaling, Tenant isolation
 */

export interface RefundTrapScenario {
    scenario_id: string;
    family: string;
    description: string;
    expected_detector_outcome: 'DETECTION' | 'SUPPRESSION';
    expected_refund_amount: number;
    expected_returned_qty: number;
    expected_reimbursed_amount: number;
    expected_shortfall: number;
    rationale: string;
    event_bundle: {
        refund_events: any[];
        return_events: any[];
        reimbursement_events: any[];
    };
}

const MOCK_SELLER = 'S1-PROTAGONIST';
const MOCK_SELLER_B = 'S2-ANTAGONIST';

const daysAgo = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
};

export const REFUND_TRAP_SCENARIOS: RefundTrapScenario[] = [
    // ========================================================================
    // FAMILY A: Healthy Refund Flows (Properly Resolved) (1-4)
    // ========================================================================
    {
        scenario_id: 'A1-HEALTHY-RETURN', family: 'Healthy flows',
        description: 'Refunded, then returned.',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 100, expected_returned_qty: 1,
        expected_reimbursed_amount: 0, expected_shortfall: 0,
        rationale: 'Customer returned the item.',
        event_bundle: {
            refund_events: [{ id: 'A1-REF-1', seller_id: MOCK_SELLER, order_id: 'A1-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'A1-RET-1', seller_id: MOCK_SELLER, order_id: 'A1-ORDER', return_date: daysAgo(40), return_status: 'received', quantity_returned: 1, created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'A2-HEALTHY-REIMB', family: 'Healthy flows',
        description: 'Refunded, then reimbursed.',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 100, expected_shortfall: 0,
        rationale: 'Amazon already paid.',
        event_bundle: {
            refund_events: [{ id: 'A2-REF-1', seller_id: MOCK_SELLER, order_id: 'A2-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: [{ id: 'A2-REIMB-1', seller_id: MOCK_SELLER, order_id: 'A2-ORDER', reimbursement_amount: 100, currency: 'USD', reimbursement_date: daysAgo(40), created_at: daysAgo(40) }]
        }
    },
    {
        scenario_id: 'A3-HEALTHY-MIXED', family: 'Healthy flows',
        description: '2 units refunded, 1 returned, 1 reimbursed.',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 200, expected_returned_qty: 1,
        expected_reimbursed_amount: 100, expected_shortfall: 0,
        rationale: 'Full reconciliation.',
        event_bundle: {
            refund_events: [{ id: 'A3-REF-1', seller_id: MOCK_SELLER, order_id: 'A3-ORDER', refund_amount: 200, currency: 'USD', refund_date: daysAgo(60), quantity_refunded: 2, created_at: daysAgo(60) }],
            return_events: [{ id: 'A3-RET-1', seller_id: MOCK_SELLER, order_id: 'A3-ORDER', return_date: daysAgo(50), return_status: 'received', quantity_returned: 1, created_at: daysAgo(50) }],
            reimbursement_events: [{ id: 'A3-REIMB-1', seller_id: MOCK_SELLER, order_id: 'A3-ORDER', reimbursement_amount: 100, currency: 'USD', reimbursement_date: daysAgo(40), created_at: daysAgo(40) }]
        }
    },
    {
        scenario_id: 'A4-RECENT-REFUND', family: 'Healthy flows',
        description: 'Refunded 10 days ago.',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 0,
        rationale: 'Inside 45-day window.',
        event_bundle: {
            refund_events: [{ id: 'A4-REF-1', seller_id: MOCK_SELLER, order_id: 'A4-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(10), created_at: daysAgo(10) }],
            return_events: [],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY B: Classic Refund Traps (5-9)
    // ========================================================================
    {
        scenario_id: 'B1-CLASSIC-TRAP', family: 'Classic traps',
        description: 'Refunded, no return, no pay.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Money owed.',
        event_bundle: {
            refund_events: [{ id: 'B1-REF-1', seller_id: MOCK_SELLER, order_id: 'B1-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'B2-BULK-TRAP', family: 'Classic traps',
        description: '5 units refunded, 0 returned.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 500, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 500,
        rationale: 'Significant loss.',
        event_bundle: {
            refund_events: [{ id: 'B2-REF-1', seller_id: MOCK_SELLER, order_id: 'B2-ORDER', refund_amount: 500, currency: 'USD', refund_date: daysAgo(50), quantity_refunded: 5, created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'B3-STALE-TRAP', family: 'Classic traps',
        description: 'Refunded 100 days ago.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Very confident detection.',
        event_bundle: {
            refund_events: [{ id: 'B3-REF-1', seller_id: MOCK_SELLER, order_id: 'B3-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(100), created_at: daysAgo(100) }],
            return_events: [],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'B4-GHOST-REIMB', family: 'Classic traps',
        description: 'Refunded, reimbursement exists for WRONG order.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'ID collision safety.',
        event_bundle: {
            refund_events: [{ id: 'B4-REF-1', seller_id: MOCK_SELLER, order_id: 'B4-ORDER-A', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: [{ id: 'B4-REIMB-1', seller_id: MOCK_SELLER, order_id: 'B4-ORDER-B', reimbursement_amount: 100, currency: 'USD', reimbursement_date: daysAgo(40), created_at: daysAgo(40) }]
        }
    },

    // ========================================================================
    // FAMILY C: Partial Payoffs (Shortfalls) (10-14)
    // ========================================================================
    {
        scenario_id: 'C1-UNDERPAID-VAL', family: 'Partial payoffs',
        description: 'Refund 100, Reimb 80.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 80, expected_shortfall: 20,
        rationale: 'Value shortfall.',
        event_bundle: {
            refund_events: [{ id: 'C1-REF-1', seller_id: MOCK_SELLER, order_id: 'C1-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: [{ id: 'C1-REIMB-1', seller_id: MOCK_SELLER, order_id: 'C1-ORDER', reimbursement_amount: 80, currency: 'USD', reimbursement_date: daysAgo(40), created_at: daysAgo(40) }]
        }
    },
    {
        scenario_id: 'C2-UNDERPAID-QTY', family: 'Partial payoffs',
        description: 'Refund 3 units, Reimb 1 unit.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 300, expected_returned_qty: 0,
        expected_reimbursed_amount: 100, expected_shortfall: 200,
        rationale: 'Quantity shortfall.',
        event_bundle: {
            refund_events: [{ id: 'C2-REF-1', seller_id: MOCK_SELLER, order_id: 'C2-ORDER', refund_amount: 300, currency: 'USD', refund_date: daysAgo(50), quantity_refunded: 3, created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: [{ id: 'C2-REIMB-1', seller_id: MOCK_SELLER, order_id: 'C2-ORDER', reimbursement_amount: 100, currency: 'USD', reimbursement_date: daysAgo(40), quantity_reimbursed: 1, created_at: daysAgo(40) }]
        }
    },
    {
        scenario_id: 'C3-MICRO-DIFF', family: 'Partial payoffs',
        description: 'Shortfall is only $0.04.',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 99.96, expected_shortfall: 0,
        rationale: 'Below threshold.',
        event_bundle: {
            refund_events: [{ id: 'C3-REF-1', seller_id: MOCK_SELLER, order_id: 'C3-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: [{ id: 'C3-REIMB-1', seller_id: MOCK_SELLER, order_id: 'C3-ORDER', reimbursement_amount: 99.96, currency: 'USD', reimbursement_date: daysAgo(40), created_at: daysAgo(40) }]
        }
    },

    // ========================================================================
    // FAMILY D: Boundary Cases (44/45/46 days) (15-18)
    // ========================================================================
    {
        scenario_id: 'D1-BOUNDARY-44', family: 'Boundary cases',
        description: 'Age 44 days.',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 0,
        rationale: 'Too young.',
        event_bundle: {
            refund_events: [{ id: 'D1-REF-1', seller_id: MOCK_SELLER, order_id: 'D1-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(44), created_at: daysAgo(44) }],
            return_events: [],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'D2-BOUNDARY-45', family: 'Boundary cases',
        description: 'Age 45 days.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Limit reached.',
        event_bundle: {
            refund_events: [{ id: 'D2-REF-1', seller_id: MOCK_SELLER, order_id: 'D2-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(45), created_at: daysAgo(45) }],
            return_events: [],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'D3-BOUNDARY-60', family: 'Boundary cases',
        description: 'Age 60 days (High confidence).',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Confident age.',
        event_bundle: {
            refund_events: [{ id: 'D3-REF-1', seller_id: MOCK_SELLER, order_id: 'D3-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(60), created_at: daysAgo(60) }],
            return_events: [],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY E: Multi-Unit Order Complexities (19-23)
    // ========================================================================
    {
        scenario_id: 'E1-MULTI-QTY-SHORTFALL', family: 'Multi-unit orders',
        description: 'Refunded 5, Returned 2, Reimb 1. Should detect 2.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 500, expected_returned_qty: 2,
        expected_reimbursed_amount: 100, expected_shortfall: 200,
        rationale: 'Complex unit reconciliation.',
        event_bundle: {
            refund_events: [{ id: 'E1-REF-1', seller_id: MOCK_SELLER, order_id: 'E1-ORDER', refund_amount: 500, currency: 'USD', refund_date: daysAgo(50), quantity_refunded: 5, created_at: daysAgo(50) }],
            return_events: [{ id: 'E1-RET-1', seller_id: MOCK_SELLER, order_id: 'E1-ORDER', return_date: daysAgo(40), quantity_returned: 2, created_at: daysAgo(40) }],
            reimbursement_events: [{ id: 'E1-REIM-1', seller_id: MOCK_SELLER, order_id: 'E1-ORDER', reimbursement_amount: 100, currency: 'USD', reimbursement_date: daysAgo(35), quantity_reimbursed: 1, created_at: daysAgo(35) }]
        }
    },
    {
        scenario_id: 'E2-OFFSET-RETURNS', family: 'Multi-unit orders',
        description: '2 refunds, 2 returns (separate events).',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 200, expected_returned_qty: 2,
        expected_reimbursed_amount: 0, expected_shortfall: 0,
        rationale: 'Linked via order_id.',
        event_bundle: {
            refund_events: [{ id: 'E2-REF-1', seller_id: MOCK_SELLER, order_id: 'E2-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(60), created_at: daysAgo(60) },
                            { id: 'E2-REF-2', seller_id: MOCK_SELLER, order_id: 'E2-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'E2-RET-1', seller_id: MOCK_SELLER, order_id: 'E2-ORDER', return_date: daysAgo(45), quantity_returned: 1, created_at: daysAgo(45) },
                            { id: 'E2-RET-2', seller_id: MOCK_SELLER, order_id: 'E2-ORDER', return_date: daysAgo(40), quantity_returned: 1, created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'E3-MULTI-SKU-ORDER', family: 'Multi-unit orders',
        description: '2 SKUs in 1 order. 1 returned, 1 trapped.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 200, expected_returned_qty: 1,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'SKU isolation required.',
        event_bundle: {
            refund_events: [{ id: 'E3-REF-A', seller_id: MOCK_SELLER, order_id: 'E3-ORDER', sku: 'SKU-A', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) },
                            { id: 'E3-REF-B', seller_id: MOCK_SELLER, order_id: 'E3-ORDER', sku: 'SKU-B', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'E3-RET-A', seller_id: MOCK_SELLER, order_id: 'E3-ORDER', sku: 'SKU-A', return_date: daysAgo(40), quantity_returned: 1, created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY F: Return Status Variants (24-28)
    // ========================================================================
    {
        scenario_id: 'F1-PENDING-OOD', family: 'Return status variants',
        description: 'Pending return > 60 days old.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Pending means never arrived.',
        event_bundle: {
            refund_events: [{ id: 'F1-REF-1', seller_id: MOCK_SELLER, order_id: 'F1-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(65), created_at: daysAgo(65) }],
            return_events: [{ id: 'F1-RET-1', seller_id: MOCK_SELLER, order_id: 'F1-ORDER', return_date: daysAgo(64), return_status: 'pending', created_at: daysAgo(64) }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'F2-CARRIER-DAMAGE', family: 'Return status variants',
        description: 'Carrier damaged return.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Carrier damage is Amazon fault.',
        event_bundle: {
            refund_events: [{ id: 'F2-REF-1', seller_id: MOCK_SELLER, order_id: 'F2-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'F2-RET-1', seller_id: MOCK_SELLER, order_id: 'F2-ORDER', return_date: daysAgo(40), return_status: 'carrier_damaged', created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'F3-REBATED-RETURN', family: 'Return status variants',
        description: 'Defective return (Seller fault).',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 100, expected_returned_qty: 1,
        expected_reimbursed_amount: 0, expected_shortfall: 0,
        rationale: 'Seller fault is not a claim.',
        event_bundle: {
            refund_events: [{ id: 'F3-REF-1', seller_id: MOCK_SELLER, order_id: 'F3-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'F3-RET-1', seller_id: MOCK_SELLER, order_id: 'F3-ORDER', return_date: daysAgo(40), return_status: 'received', disposition: 'defective', created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY G: Currency Cross-Pollination (29-32)
    // ========================================================================
    {
        scenario_id: 'G1-MXN-TRAP', family: 'Currency scale tests',
        description: 'MXN Refund.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 500, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 500,
        rationale: 'Support non-USD.',
        event_bundle: {
            refund_events: [{ id: 'G1-REF-1', seller_id: MOCK_SELLER, order_id: 'G1-ORDER', refund_amount: 500, currency: 'MXN', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'G2-EUR-TRAP', family: 'Currency scale tests',
        description: 'EUR Refund. Reimb in USD (Failure).',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Currency mismatch isolation.',
        event_bundle: {
            refund_events: [{ id: 'G2-REF-1', seller_id: MOCK_SELLER, order_id: 'G2-ORDER', refund_amount: 100, currency: 'EUR', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: [{ id: 'G2-REIMB-1', seller_id: MOCK_SELLER, order_id: 'G2-ORDER', reimbursement_amount: 110, currency: 'USD', reimbursement_date: daysAgo(40), created_at: daysAgo(40) }]
        }
    },

    // ========================================================================
    // FAMILY I: Status and Disposition Mismatch (37-40)
    // ========================================================================
    {
        scenario_id: 'I1-DAMAGED-NO-PAY', family: 'Status mismatch',
        description: 'Return received as DAMAGED. No pay.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Damaged returns are typically claimable if carrier fault.',
        event_bundle: {
            refund_events: [{ id: 'I1-REF-1', seller_id: MOCK_SELLER, order_id: 'I1-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'I1-RET-1', seller_id: MOCK_SELLER, order_id: 'I1-ORDER', return_date: daysAgo(40), return_status: 'received', disposition: 'damaged', created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'I2-DEFECTIVE-NO-PAY', family: 'Status mismatch',
        description: 'Return received as DEFECTIVE. Refunded.',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 100, expected_returned_qty: 1,
        expected_reimbursed_amount: 0, expected_shortfall: 0,
        rationale: 'Defective is seller fault.',
        event_bundle: {
            refund_events: [{ id: 'I2-REF-1', seller_id: MOCK_SELLER, order_id: 'I2-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'I2-RET-1', seller_id: MOCK_SELLER, order_id: 'I2-ORDER', return_date: daysAgo(40), return_status: 'received', disposition: 'defective', created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'I3-SWITCHEROO-TRAP', family: 'Status mismatch',
        description: 'Customer returned different item (Wrong FNSKU).',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Identifier mismatch.',
        event_bundle: {
            refund_events: [{ id: 'I3-REF-1', seller_id: MOCK_SELLER, order_id: 'I3-ORDER', sku: 'REAL-SKU', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'I3-RET-1', seller_id: MOCK_SELLER, order_id: 'I3-ORDER', sku: 'FAKE-SKU', return_date: daysAgo(40), created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY J: SKU Lookup Edge Cases (41-44)
    // ========================================================================
    {
        scenario_id: 'J1-SKU-MISSING-METADATA', family: 'SKU lookup edges',
        description: 'Refund has no SKU, return has SKU.',
        expected_detector_outcome: 'SUPPRESSION', expected_refund_amount: 100, expected_returned_qty: 1,
        expected_reimbursed_amount: 0, expected_shortfall: 0,
        rationale: 'Order-level match should fall back.',
        event_bundle: {
            refund_events: [{ id: 'J1-REF-1', seller_id: MOCK_SELLER, order_id: 'J1-ORDER', refund_amount: 100, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [{ id: 'J1-RET-1', seller_id: MOCK_SELLER, order_id: 'J1-ORDER', sku: 'SOME-SKU', return_date: daysAgo(40), created_at: daysAgo(40) }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY K: Multi-batch Refunds (45-48)
    // ========================================================================
    {
        scenario_id: 'K1-SPLIT-REFUND-TRAP', family: 'Multi-batch refunds',
        description: 'Two $50 refunds for 1 item. Half returned.',
        expected_detector_outcome: 'DETECTION', expected_refund_amount: 100, expected_returned_qty: 0,
        expected_reimbursed_amount: 0, expected_shortfall: 100,
        rationale: 'Total value check.',
        event_bundle: {
            refund_events: [{ id: 'K1-REF-1', seller_id: MOCK_SELLER, order_id: 'K1-ORDER', refund_amount: 50, currency: 'USD', refund_date: daysAgo(60), created_at: daysAgo(60) },
                            { id: 'K1-REF-2', seller_id: MOCK_SELLER, order_id: 'K1-ORDER', refund_amount: 50, currency: 'USD', refund_date: daysAgo(50), created_at: daysAgo(50) }],
            return_events: [],
            reimbursement_events: []
        }
    }
];
