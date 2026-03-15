/**
 * ISLC Benchmark Harness - Cluster 1 (Inventory)
 * 
 * Standalone evaluation script to establish baseline Precision and Recall
 * for Agent 3's "Whale Hunter" (Lost Inventory) algorithm.
 * 
 * Instructions:
 * Run with: npx ts-node src/scripts/evaluate_agent3_cluster1.ts
 */

import { detectLostInventory, SyncedData, InventoryLedgerEvent } from '../services/detection/algorithms/inventoryAlgorithms';

// Mock Seller and Sync Details
const MOCK_SELLER_ID = 'benchmark-seller-id';
const MOCK_SYNC_ID = 'benchmark-sync-id';

/**
 * 1. Control Dataset (Ground Truth)
 * 100 units: Received -> Transferred -> Sold -> Zero Balance
 */
const getControlDataset = (): InventoryLedgerEvent[] => {
    const fnsku = 'CTRL-100-FNSKU';
    const baseDate = new Date('2024-01-01');
    
    return [
        {
            id: 'ctrl-1', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Receipt',
            quantity: 100, quantity_direction: 'in', event_date: baseDate.toISOString(), created_at: baseDate.toISOString()
        },
        {
            id: 'ctrl-2', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Transfer',
            quantity: -100, quantity_direction: 'out', reference_id: 'X-100', event_date: addDays(baseDate, 5), created_at: addDays(baseDate, 5)
        },
        {
            id: 'ctrl-3', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Transfer',
            quantity: 100, quantity_direction: 'in', reference_id: 'X-100', event_date: addDays(baseDate, 10), created_at: addDays(baseDate, 10)
        },
        {
            id: 'ctrl-4', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Shipment',
            quantity: -100, quantity_direction: 'out', event_date: addDays(baseDate, 15), created_at: addDays(baseDate, 15)
        },
        {
            id: 'ctrl-5', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Snapshot',
            quantity: 0, warehouse_balance: 0, quantity_direction: 'out', event_date: addDays(baseDate, 20), created_at: addDays(baseDate, 20)
        }
    ];
};

/**
 * Mutation A (Ghost Transfer)
 * 100 received, 50 transferred out, but only 40 received at FC-2 after 35 days.
 * Expected: 10 units lost (True Positive)
 */
const getMutationA = (): InventoryLedgerEvent[] => {
    const fnsku = 'MUTA-GHOST-FNSKU';
    const baseDate = new Date('2024-01-01');
    
    return [
        {
            id: 'muta-1', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Receipt',
            quantity: 100, quantity_direction: 'in', event_date: baseDate.toISOString(), created_at: baseDate.toISOString()
        },
        {
            id: 'muta-2', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Transfer',
            quantity: -50, quantity_direction: 'out', reference_id: 'X-GHOST', event_date: addDays(baseDate, 5), created_at: addDays(baseDate, 5)
        },
        {
            id: 'muta-3', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Transfer',
            quantity: 40, quantity_direction: 'in', reference_id: 'X-GHOST', event_date: addDays(baseDate, 40), created_at: addDays(baseDate, 40)
        },
        {
            id: 'muta-4', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Snapshot',
            quantity: 90, warehouse_balance: 90, quantity_direction: 'in', event_date: addDays(baseDate, 41), created_at: addDays(baseDate, 41)
        }
    ];
};

/**
 * Mutation B (False Shrinkage)
 * 10 units marked 'M' (Misplaced) on Day 5, and exactly 10 units marked 'F' (Found) on Day 12.
 * Expected: 0 units lost (True Negative)
 */
const getMutationB = (): InventoryLedgerEvent[] => {
    const fnsku = 'MUTB-SHRINK-FNSKU';
    const baseDate = new Date('2024-01-01');
    
    return [
        {
            id: 'mutb-1', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Receipt',
            quantity: 100, quantity_direction: 'in', event_date: baseDate.toISOString(), created_at: baseDate.toISOString()
        },
        {
            id: 'mutb-2', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Adjustment',
            quantity: -10, quantity_direction: 'out', reason: 'M', event_date: addDays(baseDate, 5), created_at: addDays(baseDate, 5)
        },
        {
            id: 'mutb-3', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Adjustment',
            quantity: 10, quantity_direction: 'in', reason: 'F', event_date: addDays(baseDate, 12), created_at: addDays(baseDate, 12)
        },
        {
            id: 'mutb-4', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Snapshot',
            quantity: 100, warehouse_balance: 100, quantity_direction: 'in', event_date: addDays(baseDate, 15), created_at: addDays(baseDate, 15)
        }
    ];
};

/**
 * Mutation C (Boundary Bleed)
 * A transfer spans across a 90-day sync boundary, missing the initial receipt event but showing the final sale.
 * Expected: 0 units lost (True Negative)
 */
const getMutationC = (): InventoryLedgerEvent[] => {
    const fnsku = 'MUTC-BLEED-FNSKU';
    const baseDate = new Date('2024-01-01');
    
    // Day 0 to 89: 100 units received and kept in warehouse (but we don't see this)
    
    // Day 90 onwards: We only see the shipment and ending balance
    return [
        {
            id: 'mutc-1', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Shipment',
            quantity: -10, quantity_direction: 'out', event_date: addDays(baseDate, 95), created_at: addDays(baseDate, 95)
        },
        {
            id: 'mutc-2', seller_id: MOCK_SELLER_ID, fnsku, event_type: 'Snapshot',
            quantity: 90, warehouse_balance: 90, quantity_direction: 'in', event_date: addDays(baseDate, 100), created_at: addDays(baseDate, 100)
        }
    ];
};

// --- Utilities ---
function addDays(date: Date, days: number): string {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result.toISOString();
}

/**
 * 3. Execution Loop
 */
async function runEvaluation() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting ISLC Cluster 1 Benchmark...');
    
    const cases = [
        { name: 'Control (Healthy)', data: getControlDataset(), expectedTP: 0 },
        { name: 'Mutation A (Ghost Transfer)', data: getMutationA(), expectedTP: 1 },
        { name: 'Mutation B (False Shrinkage)', data: getMutationB(), expectedTP: 0 },
        { name: 'Mutation C (Boundary Bleed)', data: getMutationC(), expectedTP: 0 }
    ];

    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (const testCase of cases) {
        console.log(`\nEvaluating: \x1b[33m${testCase.name}\x1b[0m`);
        
        const syncData: SyncedData = {
            seller_id: MOCK_SELLER_ID,
            sync_id: MOCK_SYNC_ID,
            inventory_ledger: testCase.data
        };

        const results = detectLostInventory(MOCK_SELLER_ID, MOCK_SYNC_ID, syncData);
        const actualTP = results.length;

        console.log(`- Detected Anomalies: ${actualTP}`);
        if (actualTP > 0) {
            results.forEach(r => {
                console.log(`  - \x1b[31m[DETECTION]\x1b[0m ${r.anomaly_type}: ${r.evidence.discrepancy} units ($${r.estimated_value.toFixed(2)})`);
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
    console.log('\x1b[32m%s\x1b[0m', '📊 ISLC CLUSTER 1 FINAL METRICS');
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
}

runEvaluation().catch(err => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
});
