/**
 * ISLC Benchmark Harness - The Sentinel (Core 4/4)
 * 
 * Standalone evaluation script to establish baseline metrics for 
 * The Sentinel (Clawback & Reversal Forensics).
 * 
 * Instructions:
 * Run with: npx ts-node src/scripts/evaluate_agent3_sentinel.ts
 */

import { 
    detectDuplicateMissedReimbursements, 
    SentinelSyncedData, 
    LossEvent, 
    ReimbursementEvent as SentinelReimbEvent 
} from '../services/detection/algorithms/duplicateMissedReimbursementAlgorithm';

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
 * 1. Define Extended Interfaces for Benchmark Logic
 * (Synthesizing cross-ledger needs)
 */

interface SettlementTransaction {
    id: string;
    amount: number;
    currency: string;
    transaction_type: string; // 'reversal'
    reference_id: string;      // Matches Reimbursement ID
    date: string;
}

interface InventoryLedgerFoundEvent {
    id: string;
    event_type: 'Found';
    quantity: number;
    sku: string;
    date: string;
}

/**
 * 2. Generate Datasets
 */

// Control: 
// Day 1: Reimbursement (+$100). 
// Day 30: Inventory 'Found' (+1 unit). 
// Day 31: Settlement Reversal (-$100).
// Expected: 0 detections (Balanced Recovery)
const getControlDataset = (): SentinelSyncedData => {
    const reimbId = 'ctrl-reimb-1';
    return {
        seller_id: MOCK_SELLER_ID,
        sync_id: MOCK_SYNC_ID,
        reimbursement_events: [
            {
                id: reimbId, seller_id: MOCK_SELLER_ID, sku: 'SENTINEL-SKU-1',
                quantity: 1, amount: 100, currency: 'USD', reimbursement_date: daysAgo(45),
                order_id: 'ORDER-SENT-1'
            },
            {
                id: 'ctrl-reversal-1', seller_id: MOCK_SELLER_ID, sku: 'SENTINEL-SKU-1',
                quantity: -1, amount: -100, currency: 'USD', reimbursement_date: daysAgo(14),
                order_id: 'ORDER-SENT-1'
            }
        ],
        loss_events: [
            {
                id: 'ctrl-found-1', seller_id: MOCK_SELLER_ID, sku: 'SENTINEL-SKU-1',
                event_type: 'found', event_date: daysAgo(15), quantity: -1,
                estimated_value: -100, currency: 'USD', source: 'inventory_ledger'
            }
        ]
        // Note: Reversals in the current logic are often handled as negative reimbursements
        // but the Sentinel algorithm currently focuses on Loss vs Reimbursement.
    };
};

// Mutation A (Asymmetric): 
// Day 1: Reimbursement (+$100). 
// Day 30: Inventory 'Found' (+1 unit). 
// Day 31: Settlement Reversal (-$115).
// Expected: 1 detection (Asymmetric Clawback - $15 overcharged)
const getMutationA = (): SentinelSyncedData => {
    return {
        seller_id: MOCK_SELLER_ID,
        sync_id: MOCK_SYNC_ID,
        reimbursement_events: [
            {
                id: 'muta-reimb-1', seller_id: MOCK_SELLER_ID, sku: 'SENTINEL-SKU-2',
                quantity: 1, amount: 100, currency: 'USD', reimbursement_date: daysAgo(45),
                order_id: 'ORDER-SENT-2'
            },
            {
                id: 'muta-reversal-1', seller_id: MOCK_SELLER_ID, sku: 'SENTINEL-SKU-2',
                quantity: -1, amount: -115, currency: 'USD', reimbursement_date: daysAgo(14),
                order_id: 'ORDER-SENT-2'
            }
        ],
        loss_events: [
            {
                id: 'muta-found-1', seller_id: MOCK_SELLER_ID, sku: 'SENTINEL-SKU-2',
                event_type: 'found', event_date: daysAgo(15), quantity: -1,
                estimated_value: -100, currency: 'USD', source: 'inventory_ledger'
            }
        ]
    };
};

// Mutation B (Ghost Reversal): 
// Day 1: Reimbursement (+$100). 
// Day 30: Settlement Reversal (-$100). 
// Evaluation horizon is Day 45. No Inventory 'Found' event exists.
// Expected: 1 detection (Unjustified Reversal - Money taken, item still missing)
const getMutationB = (): SentinelSyncedData => {
    return {
        seller_id: MOCK_SELLER_ID,
        sync_id: MOCK_SYNC_ID,
        reimbursement_events: [
            {
                id: 'mutb-reimb-1', seller_id: MOCK_SELLER_ID, sku: 'SENTINEL-SKU-3',
                quantity: 1, amount: 100, currency: 'USD', reimbursement_date: daysAgo(45),
                order_id: 'ORDER-SENT-3'
            },
            {
                id: 'mutb-reversal-1', seller_id: MOCK_SELLER_ID, sku: 'SENTINEL-SKU-3',
                quantity: -1, amount: -100, currency: 'USD', reimbursement_date: daysAgo(15),
                order_id: 'ORDER-SENT-3'
            }
        ],
        loss_events: [] // No 'Found' event
    };
};

/**
 * 3. Execution Loop
 */
async function runSentinelEvaluation() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting ISLC Sentinel Benchmark (Clawback Forensics)...');

    const cases = [
        { name: 'Control (Healthy Reversal)', data: getControlDataset(), expectedTP: 0 },
        { name: 'Mutation A (Asymmetric Clawback)', data: getMutationA(), expectedTP: 1 },
        { name: 'Mutation B (Ghost Reversal)', data: getMutationB(), expectedTP: 1 }
    ];

    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (const testCase of cases) {
        console.log(`\nEvaluating: \x1b[33m${testCase.name}\x1b[0m`);

        // Execute core algorithm
        const results = await detectDuplicateMissedReimbursements(MOCK_SELLER_ID, MOCK_SYNC_ID, testCase.data);
        
        // Filter for relevant detection types
        const actualTP = results.length;

        console.log(`- Detected Anomalies: ${actualTP}`);
        if (actualTP > 0) {
            results.forEach(r => {
                const value = r.detection_type === 'missed_reimbursement' ? r.estimated_recovery : r.clawback_risk_value;
                console.log(`  - \x1b[31m[DETECTION]\x1b[0m ${r.detection_type}: $${value.toFixed(2)} for SKU ${r.sku}`);
                console.log(`    - Risk Level: ${r.risk_level} | Confidence: ${(r.confidence_score * 100).toFixed(0)}%`);
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
     * 4. Output Matrix
     */
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : (tp === 0 && fp === 0 ? 1 : 0);
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : (tp === 0 && fn === 0 ? 1 : 0);
    const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    console.log('\n' + '='.repeat(50));
    console.log('\x1b[32m%s\x1b[0m', '📊 ISLC SENTINEL BENCHMARK FINAL METRICS');
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
    console.log('\x1b[90m%s\x1b[0m', 'Note: Baseline reveals how current net-aggregation logic handles adversarial cross-ledger reversals.');
}

runSentinelEvaluation().catch(err => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
});
