/**
 * ISLC Benchmark Harness - Refunds (Cluster 3/4)
 * 
 * Standalone evaluation script to establish baseline Precision and Recall
 * for Agent 3's "Refund Trap" (Refund Without Return) algorithm.
 * 
 * Instructions:
 * Run with: npx ts-node src/scripts/evaluate_agent3_refunds.ts
 */

import { detectRefundWithoutReturn, RefundSyncedData, RefundEvent, ReturnEvent, ReimbursementEvent } from '../services/detection/algorithms/refundAlgorithms';

// Mock Seller and Sync Details
const MOCK_SELLER_ID = 'benchmark-seller-id';
const MOCK_SYNC_ID = 'benchmark-sync-id';

// Utility to create dates relative to "now"
const daysAgo = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
};

/**
 * 1. Generate Datasets
 */

// Control: Refund at Day 0, Return at Day 12.
// Evaluation at Day 48 (Refund is 48 days old).
// Expected: 0 detections (True Negative)
const getControlDataset = (): RefundSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    refund_events: [
        {
            id: 'ctrl-ref-1', seller_id: MOCK_SELLER_ID, order_id: 'CTRL-ORDER-1',
            refund_amount: 100, currency: 'USD', refund_date: daysAgo(48), created_at: daysAgo(48)
        }
    ],
    return_events: [
        {
            id: 'ctrl-ret-1', seller_id: MOCK_SELLER_ID, order_id: 'CTRL-ORDER-1',
            return_date: daysAgo(36), return_status: 'received', created_at: daysAgo(36)
        }
    ],
    reimbursement_events: []
});

// Mutation A (Classic Trap): Refund at Day 0 (48 days old). No Return, No Reimbursement.
// Expected: 1 detection (True Positive)
const getMutationA = (): RefundSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    refund_events: [
        {
            id: 'muta-ref-1', seller_id: MOCK_SELLER_ID, order_id: 'MUTA-ORDER-1',
            refund_amount: 100, currency: 'USD', refund_date: daysAgo(48), created_at: daysAgo(48)
        }
    ],
    return_events: [],
    reimbursement_events: []
});

// Mutation B (Silent Payoff): Refund at Day 0 (48 days old). No Return. 
// ReimbursementEvent at Day 46 (2 days ago).
// Expected: 0 detections (True Negative)
const getMutationB = (): RefundSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    refund_events: [
        {
            id: 'mutb-ref-1', seller_id: MOCK_SELLER_ID, order_id: 'MUTB-ORDER-1',
            refund_amount: 100, currency: 'USD', refund_date: daysAgo(48), created_at: daysAgo(48)
        }
    ],
    return_events: [],
    reimbursement_events: [
        {
            id: 'mutb-reimb-1', seller_id: MOCK_SELLER_ID, order_id: 'MUTB-ORDER-1',
            reimbursement_amount: 100, currency: 'USD', reimbursement_date: daysAgo(2),
            reimbursement_type: 'REFUND_REVERSAL', created_at: daysAgo(2)
        }
    ]
});

// Mutation C (Shortfall): Refund of $100 at Day 0 (48 days old).
// Reimbursement of $40 at Day 46 (2 days ago).
// Expected: 1 detection of $60 shortfall (True Positive) 
// [Note: Current Agent 3 logic might only check for ANY reimbursement and skip. Testing baseline.]
const getMutationC = (): RefundSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    refund_events: [
        {
            id: 'mutc-ref-1', seller_id: MOCK_SELLER_ID, order_id: 'MUTC-ORDER-1',
            refund_amount: 100, currency: 'USD', refund_date: daysAgo(48), created_at: daysAgo(48)
        }
    ],
    return_events: [],
    reimbursement_events: [
        {
            id: 'mutc-reimb-1', seller_id: MOCK_SELLER_ID, order_id: 'MUTC-ORDER-1',
            reimbursement_amount: 40, currency: 'USD', reimbursement_date: daysAgo(2),
            reimbursement_type: 'REFUND_REVERSAL', created_at: daysAgo(2)
        }
    ]
});

/**
 * 2. Execution Loop
 */
async function runRefundEvaluation() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting ISLC Refund/Order Benchmark...');
    
    const cases = [
        { name: 'Control (Healthy)', data: getControlDataset(), expectedTP: 0 },
        { name: 'Mutation A (Classic Trap)', data: getMutationA(), expectedTP: 1 },
        { name: 'Mutation B (Silent Payoff)', data: getMutationB(), expectedTP: 0 },
        { name: 'Mutation C (Shortfall)', data: getMutationC(), expectedTP: 1 }
    ];

    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (const testCase of cases) {
        console.log(`\nEvaluating: \x1b[33m${testCase.name}\x1b[0m`);
        
        const results = detectRefundWithoutReturn(MOCK_SELLER_ID, MOCK_SYNC_ID, testCase.data);
        const actualTP = results.length;

        console.log(`- Detected Anomalies: ${actualTP}`);
        if (actualTP > 0) {
            results.forEach(r => {
                console.log(`  - \x1b[31m[DETECTION]\x1b[0m ${r.anomaly_type}: $${r.estimated_value.toFixed(2)} for Order ${r.order_id}`);
                console.log(`    - Evidence: ${r.evidence.evidence_summary}`);
            });
        }

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
    const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    console.log('\n' + '='.repeat(50));
    console.log('\x1b[32m%s\x1b[0m', '📊 ISLC REFUND BENCHMARK FINAL METRICS');
    console.log('='.repeat(50));
    console.log(`True Positives (TP):  ${tp}`);
    console.log(`False Positives (FP): ${fp}`);
    console.log(`True Negatives (TN):  ${tn}`);
    console.log(`False Negatives (FN): ${fn}`);
    console.log('-'.repeat(50));
    console.log(`Precision: \x1b[35m${(precision * 100).toFixed(2)}%\x1b[0m`);
    console.log(`Recall:    \x1b[35m${(recall * 100).toFixed(2)}%\x1b[0m`);
    console.log(`F1 Score:  \x1b[35m${(f1 * 100).toFixed(2)}%\x1b[0m`);
    console.log('='.repeat(50));
    console.log('\x1b[90m%s\x1b[0m', 'Note: Mutation C (Shortfall) success indicates the engine catches mathematical underpayment, not just missing events.');
}

runRefundEvaluation().catch(err => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
});
