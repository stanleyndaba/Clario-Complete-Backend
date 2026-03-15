/**
 * ISLC Benchmark Harness - Removal Tracker (Flagship 7/7)
 * 
 * Standalone evaluation script to establish baseline metrics for 
 * the Removal Tracker (Removal Order reconciliation).
 * 
 * Run with: npx ts-node src/scripts/evaluate_agent3_removal.ts
 */

import { 
    detectRemovalAnomalies,
    RemovalSyncedData,
    RemovalOrderDetail
} from '../services/detection/algorithms/removalAlgorithms';

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

// Control: Order (10 units). Ledger: -10. Status: Completed. Horizon: Day 45.
// Expected: 0 detections
const getControlDataset = (): RemovalSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    removal_orders: [{
        id: 'ctrl-rem-1', seller_id: MOCK_SELLER_ID, order_id: 'REM-CTRL-1',
        order_type: 'Return', order_status: 'Completed', sku: 'REMOVAL-SKU-1',
        requested_quantity: 10, shipped_quantity: 10, request_date: daysAgo(46),
        created_at: daysAgo(46)
    }],
    reimbursement_events: [],
    inventory_ledger: []
});

// Mutation A (Ghost Removal): Order (10 units). Ledger: -10. Status: Pending. Horizon: Day 45.
// Expected: 0 detections (Pending orders should be ignored per SLA)
const getMutationA = (): RemovalSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    removal_orders: [{
        id: 'muta-rem-1', seller_id: MOCK_SELLER_ID, order_id: 'REM-LOST-1',
        order_type: 'Return', order_status: 'Pending', sku: 'REMOVAL-SKU-2',
        requested_quantity: 10, shipped_quantity: 0, request_date: daysAgo(46),
        created_at: daysAgo(46)
    }],
    reimbursement_events: [],
    inventory_ledger: [
        { sku: 'REMOVAL-SKU-2', quantity: 10, reason_code: 'F', event_date: daysAgo(5) }
    ]
});

// Mutation B (Cancelled Illusion): Order (10 units). Ledger: -10. Status: Cancelled. Horizon: Day 45. 
// Array CONTAINS NO +10 ledger addition. NO reimbursement.
// Expected: 1 detection (removal_unfulfilled - Status Cancelled but units not returned)
const getMutationB = (): RemovalSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    removal_orders: [{
        id: 'mutb-rem-1', seller_id: MOCK_SELLER_ID, order_id: 'REM-CANC-1',
        order_type: 'Return', order_status: 'Cancelled', sku: 'REMOVAL-SKU-3',
        requested_quantity: 10, shipped_quantity: 0, cancelled_quantity: 10,
        request_date: daysAgo(46), created_at: daysAgo(46)
    }],
    reimbursement_events: [],
    inventory_ledger: [] // No +10 return found
});

// Mutation C (Reimbursed Removal): Order (10 units). Ledger: -10. Status: Cancelled. Horizon: Day 45. 
// No +10 addition, but contains a full Reimbursement.
// Expected: 0 detections (Balanced by financial payout)
const getMutationC = (): RemovalSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    removal_orders: [{
        id: 'mutc-rem-1', seller_id: MOCK_SELLER_ID, order_id: 'REM-CANC-2',
        order_type: 'Return', order_status: 'Cancelled', sku: 'REMOVAL-SKU-4',
        requested_quantity: 10, shipped_quantity: 0, cancelled_quantity: 10,
        request_date: daysAgo(46), created_at: daysAgo(46)
    }],
    reimbursement_events: [{
        id: 'reimb-rem-1', order_id: 'REM-CANC-2', sku: 'REMOVAL-SKU-4',
        reimbursement_amount: 180, quantity_reimbursed: 10
    }],
    inventory_ledger: []
});

/**
 * 2. Execution Loop
 */
async function runRemovalEvaluation() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting ISLC Removal Tracker Benchmark (Standard & Cancelled Orders)...');

    const cases = [
        { name: 'Control (Healthy Removal)', data: getControlDataset(), expectedTP: 0 },
        { name: 'Mutation A (Ghost Removal - Pending)', data: getMutationA(), expectedTP: 0 },
        { name: 'Mutation B (Cancelled Illusion - Inventory Lost)', data: getMutationB(), expectedTP: 1 },
        { name: 'Mutation C (Reimbursed Cancelled)', data: getMutationC(), expectedTP: 0 }
    ];

    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (const testCase of cases) {
        console.log(`\nEvaluating: \x1b[33m${testCase.name}\x1b[0m`);

        // Execute core algorithm
        const results = detectRemovalAnomalies(MOCK_SELLER_ID, MOCK_SYNC_ID, testCase.data);
        const actualTP = results.length;

        console.log(`- Detected Anomalies: ${actualTP}`);
        results.forEach(r => {
            console.log(`  - \x1b[31m[DETECTION]\x1b[0m ${r.anomaly_type}: $${r.estimated_value.toFixed(2)} for Order ${r.order_id}`);
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
     * 3. Output Metrics
     */
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : (tp === 0 && fp === 0 ? 1 : 0);
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : (tp === 0 && fn === 0 ? 1 : 0);

    console.log('\n' + '='.repeat(50));
    console.log('\x1b[32m%s\x1b[0m', '📊 ISLC REMOVAL TRACKER FINAL METRICS');
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

runRemovalEvaluation().catch(err => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
});
