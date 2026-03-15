/**
 * ISLC Benchmark Harness - Broken Goods Hunter (Flagship 6/7)
 * 
 * Standalone evaluation script to establish baseline metrics for 
 * the Broken Goods Hunter (Warehouse Damage reconciliation).
 * 
 * Run with: npx ts-node src/scripts/evaluate_agent3_broken_goods.ts
 */

import { 
    detectDamagedInventory,
    DamagedSyncedData,
    DamagedEvent,
    ReimbursementEvent
} from '../services/detection/algorithms/damagedAlgorithms';

// Mock IDs
const MOCK_SELLER_ID = 'benchmark-seller-id';
const MOCK_SYNC_ID = 'benchmark-sync-id';

// Date helpers
const daysAgo = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
};

/**
 * 1. Dataset Generation
 */

// Control: Day 1: Damaged (Qty: -1). Day 15: Reimbursement (Full Value). Horizon: Day 45+
// Expected: 0 detections
const getControlDataset = (): DamagedSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    inventory_ledger: [{
        id: 'ctrl-dmg-1', seller_id: MOCK_SELLER_ID, fnsku: 'BROKEN-SKU-1',
        event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED',
        reason_code: 'E', quantity: 1, unit_value: 100, created_at: daysAgo(60)
    }],
    reimbursement_events: [{
        id: 'ctrl-reimb-1', seller_id: MOCK_SELLER_ID, fnsku: 'BROKEN-SKU-1',
        reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45),
        reimbursement_amount: 100, currency: 'USD', quantity_reimbursed: 1,
        created_at: daysAgo(45)
    }]
});

// Mutation A (Ghost Damage): Day 1: Damaged (Qty: -1). Horizon: Day 60. NO Reimbursement exists.
// Expected: 1 detection (damaged_warehouse)
const getMutationA = (): DamagedSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    inventory_ledger: [{
        id: 'muta-dmg-1', seller_id: MOCK_SELLER_ID, fnsku: 'BROKEN-SKU-2',
        event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED',
        reason_code: 'E', quantity: 1, unit_value: 100, created_at: daysAgo(60)
    }],
    reimbursement_events: []
});

// Mutation B (Shortfall): Day 1: Damaged (Qty: -1, Expected Value: $100). Day 15: Reimbursement ($12). Horizon: Day 60.
// Expected: 1 detection (Shortfall Gap - $88)
const getMutationB = (): DamagedSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    inventory_ledger: [{
        id: 'mutb-dmg-1', seller_id: MOCK_SELLER_ID, fnsku: 'BROKEN-SKU-3',
        event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED',
        reason_code: 'E', quantity: 1, unit_value: 100, created_at: daysAgo(60)
    }],
    reimbursement_events: [{
        id: 'mutb-reimb-1', seller_id: MOCK_SELLER_ID, fnsku: 'BROKEN-SKU-3',
        reimbursement_type: 'DAMAGED_WAREHOUSE', reimbursement_date: daysAgo(45),
        reimbursement_amount: 12, currency: 'USD', quantity_reimbursed: 1,
        created_at: daysAgo(45)
    }]
});

// Mutation C (The Wash): Day 1: Damaged (Qty: -1). Day 10: Found (Qty: +1). Horizon: Day 60. NO Reimbursement exists.
// Expected: 0 detections (Item recovered physically)
const getMutationC = (): DamagedSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    inventory_ledger: [
        {
            id: 'mutc-dmg-1', seller_id: MOCK_SELLER_ID, fnsku: 'BROKEN-SKU-4',
            event_type: 'Adjustment', event_date: daysAgo(60), disposition: 'DAMAGED',
            reason_code: 'E', quantity: 1, unit_value: 100, created_at: daysAgo(60)
        },
        {
            // The "Found" event in the ledger
            id: 'mutc-found-1', seller_id: MOCK_SELLER_ID, fnsku: 'BROKEN-SKU-4',
            event_type: 'Adjustment', event_date: daysAgo(50), disposition: 'SELLABLE',
            reason_code: 'F', quantity: -1, created_at: daysAgo(50) // -1 loss = +1 found
        }
    ],
    reimbursement_events: []
});

/**
 * 2. Execution Loop
 */
async function runBrokenGoodsEvaluation() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting ISLC Broken Goods Hunter Benchmark (Warehouse Damage)...');

    const cases = [
        { name: 'Control (Healthy Damage-Payout)', data: getControlDataset(), expectedTP: 0 },
        { name: 'Mutation A (Ghost Damage - No Payoff)', data: getMutationA(), expectedTP: 1 },
        { name: 'Mutation B (Shortfall - Partial Payoff)', data: getMutationB(), expectedTP: 1 },
        { name: 'Mutation C (The Wash - Physical Recovery)', data: getMutationC(), expectedTP: 0 }
    ];

    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (const testCase of cases) {
        console.log(`\nEvaluating: \x1b[33m${testCase.name}\x1b[0m`);

        // Execute core algorithm
        const results = detectDamagedInventory(MOCK_SELLER_ID, MOCK_SYNC_ID, testCase.data);
        const actualTP = results.length;

        console.log(`- Detected Anomalies: ${actualTP}`);
        results.forEach(r => {
            console.log(`  - \x1b[31m[DETECTION]\x1b[0m ${r.anomaly_type}: $${r.estimated_value.toFixed(2)} for FNSKU ${r.fnsku}`);
            console.log(`    - Confidence: ${(r.confidence_score * 100).toFixed(0)}% | Severity: ${r.severity}`);
        });

        if (testCase.expectedTP > 0) {
            if (actualTP > 0) tp += 1;
            else fn += 1;
        } else {
            if (actualTP > 0) fp += 1;
            else tn += 1;
        }
    }

    /**
     * 3. Output Matrix
     */
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : (tp === 0 && fp === 0 ? 1 : 0);
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : (tp === 0 && fn === 0 ? 1 : 0);

    console.log('\n' + '='.repeat(50));
    console.log('\x1b[32m%s\x1b[0m', '📊 ISLC BROKEN GOODS BENCHMARK FINAL METRICS');
    console.log('='.repeat(50));
    console.log(`True Positives (TP):  ${tp}`);
    console.log(`False Positives (FP): ${fp}`);
    console.log(`True Negatives (TN):  ${tn}`);
    console.log(`False Negatives (FN): ${fn}`);
    console.log('-'.repeat(50));
    console.log(`Precision: \x1b[35m${(precision * 100).toFixed(2)}%\x1b[0m`);
    console.log(`Recall:    \x1b[35m${(recall * 100).toFixed(2)}%\x1b[0m`);
    console.log('='.repeat(50));
}

runBrokenGoodsEvaluation().catch(err => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
});
