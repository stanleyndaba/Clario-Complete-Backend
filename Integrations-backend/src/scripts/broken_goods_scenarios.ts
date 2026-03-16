/**
 * Broken Goods Hunter - Adversarial Scenario Library
 * 
 * 12 Families, 40 Scenarios
 * Focus: Ledger Deduplication, Reimb Linkage, Physical Recovery, Valuation
 */

export interface BrokenGoodsScenario {
    scenario_id: string;
    family: string;
    description: string;
    expected_detector_outcome: 'DETECTION' | 'SUPPRESSION';
    expected_damaged_units: number;
    expected_recovered_units: number;
    expected_reimbursed_units_or_value: number;
    expected_unresolved_units: number;
    expected_claimable_units_or_value: number;
    physical_truth: string;
    claimable_truth: string;
    expected_value_status: 'MATCH' | 'UNDERPAYMENT' | 'OVERPAYMENT';
    rationale: string;
    event_bundle: {
        inventory_ledger: any[];
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

export const BROKEN_GOODS_SCENARIOS: BrokenGoodsScenario[] = [
    // ========================================================================
    // FAMILY A: Healthy Damage Flows (Properly Reimbursed) (1-4)
    // ========================================================================
    {
        scenario_id: 'A1-HEALTHY-E', family: 'Healthy damage flows',
        description: 'Code E (Warehouse). Reimbursed.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 20, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: '1 damaged.', claimable_truth: 'Paid.', expected_value_status: 'MATCH',
        rationale: 'Healthy lifecycle.',
        event_bundle: {
            inventory_ledger: [{ id: 'A1-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-A1', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'A1-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-A1', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'A2-HEALTHY-M', family: 'Healthy damage flows',
        description: 'Code M (Inbound). Reimbursed.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 20, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: '1 damaged.', claimable_truth: 'Paid.', expected_value_status: 'MATCH',
        rationale: 'Healthy inbound damage.',
        event_bundle: {
            inventory_ledger: [{ id: 'A2-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-A2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'M', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'A2-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-A2', reimbursement_type: 'DAMAGED_INBOUND', reimbursement_date: daysAgo(45), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'A3-HEALTHY-Q', family: 'Healthy damage flows',
        description: 'Code Q (Returns). Reimbursed.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 20, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: '1 damaged.', claimable_truth: 'Paid.', expected_value_status: 'MATCH',
        rationale: 'Healthy return damage.',
        event_bundle: {
            inventory_ledger: [{ id: 'A3-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-A3', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'Q', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'A3-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-A3', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'A4-HEALTHY-K', family: 'Healthy damage flows',
        description: 'Code K (Removal). Reimbursed.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 20, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: '1 damaged.', claimable_truth: 'Paid.', expected_value_status: 'MATCH',
        rationale: 'Healthy removal damage.',
        event_bundle: {
            inventory_ledger: [{ id: 'A4-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-A4', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'K', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'A4-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-A4', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },

    // ========================================================================
    // FAMILY B: True Unreimbursed Damage (5-9)
    // ========================================================================
    {
        scenario_id: 'B1-GHOST-E', family: 'True unreimbursed damage',
        description: 'Code E. No pay.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: '1 lost.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Classic unreimbursed item.',
        event_bundle: {
            inventory_ledger: [{ id: 'B1-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-B1', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'B2-GHOST-M', family: 'True unreimbursed damage',
        description: 'Code M. No pay.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: '1 lost.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Classic unreimbursed inbound.',
        event_bundle: {
            inventory_ledger: [{ id: 'B2-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-B2', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DAMAGED', reason_code: 'M', quantity: 1, unit_value: 20 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'B3-GHOST-H', family: 'True unreimbursed damage',
        description: 'Code H. No pay.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: '1 lost.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Classic unreimbursed transfer.',
        event_bundle: {
            inventory_ledger: [{ id: 'B3-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-B3', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DAMAGED', reason_code: 'H', quantity: 1, unit_value: 20 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'B4-MULTI-UNIT-GHOST', family: 'True unreimbursed damage',
        description: '10 units damaged. No pay.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 10, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 10, expected_claimable_units_or_value: 200,
        physical_truth: '10 lost.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Bulk loss.',
        event_bundle: {
            inventory_ledger: [{ id: 'B4-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-B4', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DAMAGED', reason_code: 'E', quantity: 10, unit_value: 20 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'B5-STALE-DAMAGE', family: 'True unreimbursed damage',
        description: 'Damage from 180 days ago.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 15,
        physical_truth: 'Very old loss.', claimable_truth: 'Claimable.', expected_value_status: 'MATCH',
        rationale: 'Policy window is long.',
        event_bundle: {
            inventory_ledger: [{ id: 'B5-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-B5', event_type: 'Adjustment', event_date: daysAgo(180), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY C: Partial Reimbursements (10-14)
    // ========================================================================
    {
        scenario_id: 'C1-UNDERPAID-50', family: 'Partial reimbursements',
        description: '50% paid.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 10, expected_unresolved_units: 1, expected_claimable_units_or_value: 10,
        physical_truth: '1 damaged.', claimable_truth: 'Owed half.', expected_value_status: 'UNDERPAYMENT',
        rationale: 'Value reconciliation failure.',
        event_bundle: {
            inventory_ledger: [{ id: 'C1-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-C1', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'C1-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-C1', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 10, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'C2-QUANTITY-SHORTFALL', family: 'Partial reimbursements',
        description: '3 damaged, 1 paid.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 3, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 20, expected_unresolved_units: 2, expected_claimable_units_or_value: 40,
        physical_truth: '3 damaged.', claimable_truth: '2 owed.', expected_value_status: 'MATCH',
        rationale: 'Unit count reconciliation failure.',
        event_bundle: {
            inventory_ledger: [{ id: 'C2-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-C2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 3, unit_value: 20 }],
            reimbursement_events: [{ id: 'C2-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-C2', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'C3-MICRO-SHORTFALL', family: 'Partial reimbursements',
        description: '$0.04 shortfall (suppress).',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 19.96, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: '1 damaged.', claimable_truth: 'Negligible.', expected_value_status: 'MATCH',
        rationale: 'Sub-threshold drift should be ignored.',
        event_bundle: {
            inventory_ledger: [{ id: 'C3-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-C3', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'C3-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-C3', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 19.96, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'C4-LATE-REIMB', family: 'Partial reimbursements',
        description: 'Reimbursement outside 45D window.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: '1 damaged.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Financial linkage expired.',
        event_bundle: {
            inventory_ledger: [{ id: 'C4-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-C4', event_type: 'Adjustment', event_date: daysAgo(100), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'C4-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-C4', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(10), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'C5-OVERPAID-VALUATION', family: 'Partial reimbursements',
        description: 'Paid $100 for $20 item.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 100, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'Overpaid.', claimable_truth: 'No claim.', expected_value_status: 'OVERPAYMENT',
        rationale: 'Negative shortfalls are not claims.',
        event_bundle: {
            inventory_ledger: [{ id: 'C5-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-C5', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'C5-R1', seller_id: MOCK_SELLER, fnsku: 'SKU-C5', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 100, quantity_reimbursed: 1 }]
        }
    },

    // ========================================================================
    // FAMILY E: Found Inventory / Physical Recovery (15-18)
    // ========================================================================
    {
        scenario_id: 'E1-FOUND-F', family: 'Found inventory / physical recovery',
        description: 'Damage + Found (F).',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 1,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'Found.', claimable_truth: 'Resolved.', expected_value_status: 'MATCH',
        rationale: 'Code F wash.',
        event_bundle: {
            inventory_ledger: [{ id: 'E1-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-E1', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 },
                               { id: 'E1-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-E1', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'SELLABLE', reason_code: 'F', quantity: -1 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'E2-FOUND-WORD', family: 'Found inventory / physical recovery',
        description: 'Damage + reason: "FOUND".',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 1,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'Found.', claimable_truth: 'Resolved.', expected_value_status: 'MATCH',
        rationale: 'String "FOUND" wash.',
        event_bundle: {
            inventory_ledger: [{ id: 'E2-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-E2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 },
                               { id: 'E2-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-E2', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'SELLABLE', reason_code: 'FOUND', quantity: -1 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'E3-PARTIAL-FOUND', family: 'Found inventory / physical recovery',
        description: '10 damaged, 3 found.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 10, expected_recovered_units: 3,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 7, expected_claimable_units_or_value: 140,
        physical_truth: '7 lost.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Partial wash.',
        event_bundle: {
            inventory_ledger: [{ id: 'E3-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-E3', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 10, unit_value: 20 },
                               { id: 'E3-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-E3', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'SELLABLE', reason_code: 'F', quantity: -3 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'E4-FOUND-BAD-DISPO', family: 'Found inventory / physical recovery',
        description: 'Found into UNSELLABLE.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: 'Still broken.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Recovery must be sellable.',
        event_bundle: {
            inventory_ledger: [{ id: 'E4-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-E4', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 },
                               { id: 'E4-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-E4', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'UNSELLABLE', reason_code: 'F', quantity: -1 }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY F: Generic Adjustment Recovery Variants (19-22)
    // ========================================================================
    {
        scenario_id: 'F1-GREY-P', family: 'Generic adjustment recovery variants',
        description: 'Reason P recovery.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 1,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'Restored.', claimable_truth: 'Resolved.', expected_value_status: 'MATCH',
        rationale: 'P-wash blindness.',
        event_bundle: {
            inventory_ledger: [{ id: 'F1-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-F1', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 },
                               { id: 'F1-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-F1', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'SELLABLE', reason_code: 'P', quantity: -1 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'F2-GREY-O', family: 'Generic adjustment recovery variants',
        description: 'Reason O recovery.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 1,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'Restored.', claimable_truth: 'Resolved.', expected_value_status: 'MATCH',
        rationale: 'O-wash blindness.',
        event_bundle: {
            inventory_ledger: [{ id: 'F2-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-F2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 },
                               { id: 'F2-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-F2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'SELLABLE', reason_code: 'O', quantity: -1 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'F3-GREY-NO-CODE', family: 'Generic adjustment recovery variants',
        description: 'No reason code reversal.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 1,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'Restored.', claimable_truth: 'Resolved.', expected_value_status: 'MATCH',
        rationale: 'Implicit wash blindness.',
        event_bundle: {
            inventory_ledger: [{ id: 'F3-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-F3', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 },
                               { id: 'F3-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-F3', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'SELLABLE', reason_code: '', quantity: -1 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'F4-BURN-EVENT', family: 'Generic adjustment recovery variants',
        description: 'Damage + Disposal.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: 'Burnt.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Disposal is not recovery.',
        event_bundle: {
            inventory_ledger: [{ id: 'F4-L1', seller_id: MOCK_SELLER, fnsku: 'SKU-F4', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 },
                               { id: 'F4-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-F4', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DISPOSED', reason_code: '10', quantity: -1 }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY G: Duplicate Damage Event Contamination (23-27)
    // ========================================================================
    {
        scenario_id: 'G1-ID-STUTTER', family: 'Duplicate damage event contamination',
        description: 'Same event, different ID.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: '1 loss.', claimable_truth: '1 claim.', expected_value_status: 'MATCH',
        rationale: 'Deduplication failure.',
        event_bundle: {
            inventory_ledger: [{ id: 'G1-A', seller_id: MOCK_SELLER, fnsku: 'SKU-G1', event_type: 'Adjustment', event_date: '2026-01-01T12:00:00Z', disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 },
                               { id: 'G1-B', seller_id: MOCK_SELLER, fnsku: 'SKU-G1', event_type: 'Adjustment', event_date: '2026-01-01T12:00:00Z', disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'G2-LOG-OFFSET-WASH', family: 'Duplicate damage event contamination',
        description: 'Damage + clerical correction.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 0, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'Clerical error.', claimable_truth: 'Resolved.', expected_value_status: 'MATCH',
        rationale: 'Netting failure.',
        event_bundle: {
            inventory_ledger: [{ id: 'G2-A', seller_id: MOCK_SELLER, fnsku: 'SKU-G2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 },
                               { id: 'G2-B', seller_id: MOCK_SELLER, fnsku: 'SKU-G2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'SELLABLE', reason_code: 'E', quantity: -1 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'G3-RE-SYNC', family: 'Duplicate damage event contamination',
        description: 'Repeated sync rows.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: '1 loss.', claimable_truth: '1 claim.', expected_value_status: 'MATCH',
        rationale: 'Idempotency failure.',
        event_bundle: {
            inventory_ledger: [{ id: 'G3-A', seller_id: MOCK_SELLER, fnsku: 'SKU-G3', event_type: 'Adjustment', event_date: daysAgo(55), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'G4-REAL-DOUBLE', family: 'Duplicate damage event contamination',
        description: '2 separate losses.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 2, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 2, expected_claimable_units_or_value: 40,
        physical_truth: '2 incidents.', claimable_truth: '2 claims.', expected_value_status: 'MATCH',
        rationale: 'Distinct times.',
        event_bundle: {
            inventory_ledger: [{ id: 'G4-A', seller_id: MOCK_SELLER, fnsku: 'SKU-G4', event_type: 'Adjustment', event_date: '2026-01-01T12:00:00Z', disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 },
                               { id: 'G4-B', seller_id: MOCK_SELLER, fnsku: 'SKU-G4', event_type: 'Adjustment', event_date: '2026-01-01T13:00:00Z', disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'G5-FC-SPLIT', family: 'Duplicate damage event contamination',
        description: 'Same time, diff FC.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 2, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 2, expected_claimable_units_or_value: 40,
        physical_truth: '2 incidents.', claimable_truth: '2 claims.', expected_value_status: 'MATCH',
        rationale: 'Distinct locations.',
        event_bundle: {
            inventory_ledger: [{ id: 'G5-A', seller_id: MOCK_SELLER, fnsku: 'SKU-G5', event_type: 'Adjustment', event_date: '2026-01-01T12:00:00Z', disposition: 'DAMAGED', reason_code: 'E', quantity: 1, fulfillment_center_id: 'FC1', unit_value: 20 },
                               { id: 'G5-B', seller_id: MOCK_SELLER, fnsku: 'SKU-G5', event_type: 'Adjustment', event_date: '2026-01-01T12:00:00Z', disposition: 'DAMAGED', reason_code: 'E', quantity: 1, fulfillment_center_id: 'FC2', unit_value: 20 }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY H: Cross-tenant FNSKU Collisions (28-31)
    // ========================================================================
    {
        scenario_id: 'H1-LEAK', family: 'Cross-tenant FNSKU collisions',
        description: 'Seller B pay matches Seller A loss.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: 'Seller A lost.', claimable_truth: 'Tenant isolation failure.', expected_value_status: 'MATCH',
        rationale: 'FNSKU collision leak.',
        event_bundle: {
            inventory_ledger: [{ id: 'H1-L', seller_id: MOCK_SELLER, fnsku: 'FNSKU-X', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'H1-R', seller_id: MOCK_SELLER_B, fnsku: 'FNSKU-X', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'H2-ISOLATE-SELF', family: 'Cross-tenant FNSKU collisions',
        description: 'Correct self-link.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 20, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'Self reimbursed.', claimable_truth: 'Resolved.', expected_value_status: 'MATCH',
        rationale: 'Correct linkage.',
        event_bundle: {
            inventory_ledger: [{ id: 'H2-L', seller_id: MOCK_SELLER, fnsku: 'FNSKU-Y', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'H2-R', seller_id: MOCK_SELLER, fnsku: 'FNSKU-Y', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'H3-OVERLAP', family: 'Cross-tenant FNSKU collisions',
        description: 'Seller A loss, Seller B partial pay.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: 'Seller A lost.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'B history ignored.',
        event_bundle: {
            inventory_ledger: [{ id: 'H3-L', seller_id: MOCK_SELLER, fnsku: 'FNSKU-Z', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 }],
            reimbursement_events: [{ id: 'H3-R', seller_id: MOCK_SELLER_B, fnsku: 'FNSKU-Z', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 10, quantity_reimbursed: 0.5 }]
        }
    },
    {
        scenario_id: 'H4-CROSS-TENANT-PHYSICAL', family: 'Cross-tenant FNSKU collisions',
        description: 'Seller A loss, Seller B found.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: 'Seller A loss.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Physical wash must isolate tenant.',
        event_bundle: {
            inventory_ledger: [{ id: 'H4-L1', seller_id: MOCK_SELLER, fnsku: 'FNSKU-W', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 },
                               { id: 'H4-L2', seller_id: MOCK_SELLER_B, fnsku: 'FNSKU-W', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'SELLABLE', reason_code: 'F', quantity: -1 }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY I: Transfer-damage (32-33)
    // ========================================================================
    {
        scenario_id: 'I1-CODE-H', family: 'Transfer-damage attribution confusion',
        description: 'Transit loss H.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: 'Transfer lost.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'H-mapping check.',
        event_bundle: {
            inventory_ledger: [{ id: 'I1-L', seller_id: MOCK_SELLER, fnsku: 'SKU-I1', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'H', quantity: 1, unit_value: 20 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'I2-CODE-M', family: 'Transfer-damage attribution confusion',
        description: 'Inbound loss M.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: 'Inbound lost.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'M-mapping check.',
        event_bundle: {
            inventory_ledger: [{ id: 'I2-L', seller_id: MOCK_SELLER, fnsku: 'SKU-I2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'M', quantity: 1, unit_value: 20 }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY J: Multi-unit Split Scenarios (34-36)
    // ========================================================================
    {
        scenario_id: 'J1-SPLIT-3', family: 'Multi-unit split scenarios',
        description: '3 damaged. 1 found, 1 paid, 1 ower.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 3, expected_recovered_units: 1,
        expected_reimbursed_units_or_value: 20, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: '3 damaged.', claimable_truth: '1 owed.', expected_value_status: 'MATCH',
        rationale: 'Subtraction check.',
        event_bundle: {
            inventory_ledger: [{ id: 'J1-L', seller_id: MOCK_SELLER, fnsku: 'SKU-J1', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 3, unit_value: 20 },
                               { id: 'J1-F', seller_id: MOCK_SELLER, fnsku: 'SKU-J1', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'SELLABLE', reason_code: 'F', quantity: -1 }],
            reimbursement_events: [{ id: 'J1-R', seller_id: MOCK_SELLER, fnsku: 'SKU-J1', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 20, quantity_reimbursed: 1 }]
        }
    },
    {
        scenario_id: 'J2-OVERLINK', family: 'Multi-unit split scenarios',
        description: '5 damaged, 4 paid.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 5, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 80, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: '5 loss.', claimable_truth: '1 owed.', expected_value_status: 'MATCH',
        rationale: 'Partial quantity linkage.',
        event_bundle: {
            inventory_ledger: [{ id: 'J2-L', seller_id: MOCK_SELLER, fnsku: 'SKU-J2', event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED', reason_code: 'E', quantity: 5, unit_value: 20 }],
            reimbursement_events: [{ id: 'J2-R', seller_id: MOCK_SELLER, fnsku: 'SKU-J2', reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45), reimbursement_amount: 80, quantity_reimbursed: 4 }]
        }
    },

    // ========================================================================
    // FAMILY K: Late Recovery Boundary (37-38)
    // ========================================================================
    {
        scenario_id: 'K1-SLA-31', family: 'Late recovery boundary cases (30/31 day style)',
        description: 'Found day 31.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 20,
        physical_truth: 'SLA fail.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Strict SLA.',
        event_bundle: {
            inventory_ledger: [{ id: 'K1-L', seller_id: MOCK_SELLER, fnsku: 'SKU-K1', event_type: 'Adjustment', event_date: daysAgo(40), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 20 },
                               { id: 'K1-F', seller_id: MOCK_SELLER, fnsku: 'SKU-K1', event_type: 'Adjustment', event_date: daysAgo(5), disposition: 'SELLABLE', reason_code: 'F', quantity: -1 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'K2-SLA-29', family: 'Late recovery boundary cases (30/31 day style)',
        description: 'Found day 29.',
        expected_detector_outcome: 'SUPPRESSION', expected_damaged_units: 1, expected_recovered_units: 1,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 0, expected_claimable_units_or_value: 0,
        physical_truth: 'SLA pass.', claimable_truth: 'Resolved.', expected_value_status: 'MATCH',
        rationale: 'Inside SLA.',
        event_bundle: {
            inventory_ledger: [{ id: 'K2-L', seller_id: MOCK_SELLER, fnsku: 'SKU-K2', event_type: 'Adjustment', event_date: daysAgo(40), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 },
                               { id: 'K2-L2', seller_id: MOCK_SELLER, fnsku: 'SKU-K2', event_type: 'Adjustment', event_date: daysAgo(15), disposition: 'SELLABLE', reason_code: 'F', quantity: -1 }],
            reimbursement_events: []
        }
    },

    // ========================================================================
    // FAMILY L: Valuation Ladder (39-42)
    // ========================================================================
    {
        scenario_id: 'L1-LADDER-VAL', family: 'Valuation ladder / valuation cliff cases',
        description: 'Ledger $50.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 50,
        physical_truth: 'Owed $50.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Ledger priority.',
        event_bundle: {
            inventory_ledger: [{ id: 'L1-L', seller_id: MOCK_SELLER, fnsku: 'SKU-L1', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, unit_value: 50 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'L2-LADDER-ASP', family: 'Valuation ladder / valuation cliff cases',
        description: 'ASP $35.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 35,
        physical_truth: 'Owed $35.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'ASP fallback.',
        event_bundle: {
            inventory_ledger: [{ id: 'L2-L', seller_id: MOCK_SELLER, fnsku: 'SKU-L2', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, average_sales_price: 35 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'L3-LADDER-DEF', family: 'Valuation ladder / valuation cliff cases',
        description: 'Default $15.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 15,
        physical_truth: 'Owed $15.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Final fallback.',
        event_bundle: {
            inventory_ledger: [{ id: 'L3-L', seller_id: MOCK_SELLER, fnsku: 'SKU-L3', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DAMAGED', reason_code: 'E', quantity: 1 }],
            reimbursement_events: []
        }
    },
    {
        scenario_id: 'L4-LADDER-CLIFF', family: 'Valuation ladder / valuation cliff cases',
        description: 'ASP $30 vs Default $15.',
        expected_detector_outcome: 'DETECTION', expected_damaged_units: 1, expected_recovered_units: 0,
        expected_reimbursed_units_or_value: 0, expected_unresolved_units: 1, expected_claimable_units_or_value: 30,
        physical_truth: 'Owed $30.', claimable_truth: 'Owed.', expected_value_status: 'MATCH',
        rationale: 'Ladder priority check.',
        event_bundle: {
            inventory_ledger: [{ id: 'L4-L', seller_id: MOCK_SELLER, fnsku: 'SKU-L4', event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'DAMAGED', reason_code: 'E', quantity: 1, average_sales_price: 30 }],
            reimbursement_events: []
        }
    }
];
