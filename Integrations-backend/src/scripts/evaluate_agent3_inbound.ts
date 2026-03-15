/**
 * ISLC Benchmark Harness - Inbound Inspector (Flagship 5/7)
 * 
 * Standalone evaluation script to establish baseline metrics for 
 * the Inbound Inspector (Shipment Reconciliation).
 * 
 * Run with: npx ts-node src/scripts/evaluate_agent3_inbound.ts
 */

import { 
    detectInboundAnomalies,
    InboundSyncedData,
    InboundShipmentItem,
    InboundReimbursement
} from '../services/detection/algorithms/inboundAlgorithms';

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
 * Dataset Generation
 */

// Control: Shipped: 100. Received: 100. Status: CLOSED. Date: Past SLA (95 days ago).
// Expected: 0 detections
const getControlDataset = (): InboundSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    inbound_shipment_items: [{
        id: 'ctrl-item-1', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-CTRL',
        sku: 'INBOUND-SKU-1', quantity_shipped: 100, quantity_received: 100,
        shipment_status: 'CLOSED', shipment_created_date: daysAgo(100),
        shipment_closed_date: daysAgo(95), created_at: daysAgo(100)
    }],
    reimbursement_events: []
});

// Mutation A (Shortfall): Shipped: 100. Received: 90. Status: CLOSED. Date: Past SLA (95 days ago).
// Expected: 1 detection (shipment_shortage)
const getMutationA = (): InboundSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    inbound_shipment_items: [{
        id: 'muta-item-1', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-SHORT-1',
        sku: 'INBOUND-SKU-2', quantity_shipped: 100, quantity_received: 90,
        shipment_status: 'CLOSED', shipment_created_date: daysAgo(100),
        shipment_closed_date: daysAgo(95), created_at: daysAgo(100)
    }],
    reimbursement_events: []
});

// Mutation B (Premature): Shipped: 100. Received: 90. Status: RECEIVING. Date: Before SLA.
// Expected: 0 detections (Not yet CLOSED / Not past SLA)
const getMutationB = (): InboundSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    inbound_shipment_items: [{
        id: 'mutb-item-1', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-PREM-1',
        sku: 'INBOUND-SKU-3', quantity_shipped: 100, quantity_received: 90,
        shipment_status: 'RECEIVING', shipment_created_date: daysAgo(10),
        created_at: daysAgo(10)
    }],
    reimbursement_events: []
});

// Mutation C (Reimbursed): Shipped: 100. Received: 90. Status: CLOSED. Date: Past SLA (95 days ago). Reimbursement exists.
// Expected: 0 detections (Already compensated)
const getMutationC = (): InboundSyncedData => ({
    seller_id: MOCK_SELLER_ID,
    sync_id: MOCK_SYNC_ID,
    inbound_shipment_items: [{
        id: 'mutc-item-1', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-REIMB-1',
        sku: 'INBOUND-SKU-4', quantity_shipped: 100, quantity_received: 90,
        shipment_status: 'CLOSED', shipment_created_date: daysAgo(100),
        shipment_closed_date: daysAgo(95), created_at: daysAgo(100)
    }],
    reimbursement_events: [{
        id: 'reimb-1', seller_id: MOCK_SELLER_ID, shipment_id: 'SHIP-REIMB-1',
        sku: 'INBOUND-SKU-4', reimbursement_amount: 180, currency: 'USD',
        reimbursement_date: daysAgo(92), created_at: daysAgo(92)
    }]
});

/**
 * Execution Loop
 */
async function runInboundEvaluation() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting ISLC Inbound Inspector Benchmark...');

    const cases = [
        { name: 'Control (Healthy)', data: getControlDataset(), expectedTP: 0 },
        { name: 'Mutation A (Shortfall - Past SLA)', data: getMutationA(), expectedTP: 1 },
        { name: 'Mutation B (Premature - Receiving)', data: getMutationB(), expectedTP: 0 },
        { name: 'Mutation C (Already Reimbursed)', data: getMutationC(), expectedTP: 0 }
    ];

    let tp = 0, fp = 0, tn = 0, fn = 0;

    for (const testCase of cases) {
        console.log(`\nEvaluating: \x1b[33m${testCase.name}\x1b[0m`);

        // Execute algorithm
        const results = detectInboundAnomalies(MOCK_SELLER_ID, MOCK_SYNC_ID, testCase.data);
        const actualTP = results.length;

        console.log(`- Detected Anomalies: ${actualTP}`);
        results.forEach(r => {
            console.log(`  - \x1b[31m[DETECTION]\x1b[0m ${r.anomaly_type}: $${r.estimated_value.toFixed(2)} for SKU ${r.sku}`);
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

    // Metrics
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : (tp === 0 && fp === 0 ? 1 : 0);
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : (tp === 0 && fn === 0 ? 1 : 0);

    console.log('\n' + '='.repeat(50));
    console.log('\x1b[32m%s\x1b[0m', '📊 ISLC INBOUND INSPECTOR FINAL METRICS');
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

runInboundEvaluation().catch(err => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
});
