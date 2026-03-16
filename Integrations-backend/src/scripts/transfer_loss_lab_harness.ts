/**
 * Transfer Loss Calibration Lab Harness
 * 
 * Objectives:
 * 1. Dual-path evaluation (Path A vs Path B)
 * 2. Quantity ground-truth verification
 * 3. Path disagreement reporting
 * 4. Boundary and adversarial stress testing
 */

import { detectWarehouseTransferLoss, TransferRecord } from '../services/detection/algorithms/warehouseTransferLossAlgorithm';
import { detectLostInventory, SyncedData, InventoryLedgerEvent } from '../services/detection/algorithms/inventoryAlgorithms';
import { TRANSFER_LOSS_SCENARIOS, TransferLossScenario } from './transfer_loss_scenarios';

// Mock Sync Details
const MOCK_SYNC_ID = new Date().toISOString();

interface PathResult {
    detected: boolean;
    unresolved_units: number;
    claimable_units: number;
    errors: string[];
}

interface EvaluationMetrics {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    total_unit_error: number;
    overcounts: number;
    undercounts: number;
}

async function runHarness() {
    console.log('\x1b[36m%s\x1b[0m', '🧪 [TRANSFER-LOSS-LAB] Starting Calibration Session...');
    console.log(`Total Scenarios: ${TRANSFER_LOSS_SCENARIOS.length}`);

    const metricsA: EvaluationMetrics = { tp: 0, fp: 0, tn: 0, fn: 0, total_unit_error: 0, overcounts: 0, undercounts: 0 };
    const metricsB: EvaluationMetrics = { tp: 0, fp: 0, tn: 0, fn: 0, total_unit_error: 0, overcounts: 0, undercounts: 0 };

    const disagreements = {
        pathA_pos_pathB_neg: [] as string[],
        pathB_pos_pathA_neg: [] as string[],
        unit_disagreement: [] as string[],
        both_miss: [] as string[]
    };

    for (const scenario of TRANSFER_LOSS_SCENARIOS) {
        console.log(`\n[\x1b[35m${scenario.id}\x1b[0m] ${scenario.family}: ${scenario.description}`);
        const scenarioSellerId = scenario.events[0]?.seller_id || 'seller-tl-1';

        // --- Execute Path A (Shallow) ---
        const resultsA = await detectWarehouseTransferLoss(
            scenarioSellerId,
            MOCK_SYNC_ID,
            scenario.transfer_records
        );
        
        // Sum units for Path A
        const unitsA = resultsA.reduce((sum, r) => sum + r.quantity_lost, 0);
        const pathA: PathResult = {
            detected: resultsA.length > 0,
            unresolved_units: unitsA,
            claimable_units: unitsA,
            errors: []
        };

        // --- Execute Path B (Forensic) ---
        const syncData: SyncedData = {
            seller_id: scenarioSellerId,
            sync_id: MOCK_SYNC_ID,
            inventory_ledger: scenario.events,
            financial_events: scenario.financial_events || []
        };

        const resultsB = detectLostInventory(scenarioSellerId, MOCK_SYNC_ID, syncData);
        const transferResultsB = resultsB.filter(r => r.anomaly_type === 'lost_in_transit' || r.anomaly_type === 'lost_warehouse');
        
        // Updated to use the new evidence field
        const unitsB = transferResultsB.reduce((sum, r) => sum + (r.evidence.net_unresolved_units ?? r.evidence.unresolved_transfer_units ?? r.evidence.discrepancy ?? 0), 0);
        
        const pathB: PathResult = {
            detected: transferResultsB.length > 0,
            unresolved_units: unitsB,
            claimable_units: unitsB,
            errors: []
        };

        // --- Evaluate Path A ---
        evaluatePath(scenario, pathA, metricsA);
        
        // --- Evaluate Path B ---
        evaluatePath(scenario, pathB, metricsB);

        // --- Disagreement Reporting ---
        if (pathA.detected && !pathB.detected) disagreements.pathA_pos_pathB_neg.push(scenario.id);
        if (!pathA.detected && pathB.detected) disagreements.pathB_pos_pathA_neg.push(scenario.id);
        if (pathA.detected && pathB.detected && Math.abs(pathA.unresolved_units - pathB.unresolved_units) > 0.1) {
            disagreements.unit_disagreement.push(`${scenario.id} (A:${pathA.unresolved_units} vs B:${pathB.unresolved_units})`);
        }
        if (scenario.outcome === 'positive' && !pathA.detected && !pathB.detected) {
            disagreements.both_miss.push(scenario.id);
        }

        console.log(`  Path A: ${pathA.detected ? '✅' : '❌'} (${pathA.unresolved_units} units)`);
        console.log(`  Path B: ${pathB.detected ? '✅' : '❌'} (${pathB.unresolved_units} units)`);
        console.log(`  Truth : ${scenario.outcome === 'positive' ? '✅' : '❌'} (${scenario.expected_unresolved_units} units)`);
    }

    // --- Final Report ---
    printReport('Path A (Shallow)', metricsA);
    printReport('Path B (Forensic)', metricsB);

    console.log('\n--- Path Disagreement Matrix ---');
    console.log(`Path A(+) / Path B(-): ${disagreements.pathA_pos_pathB_neg.length} [${disagreements.pathA_pos_pathB_neg.join(', ')}]`);
    console.log(`Path B(+) / Path A(-): ${disagreements.pathB_pos_pathA_neg.length} [${disagreements.pathB_pos_pathA_neg.join(', ')}]`);
    console.log(`Unit Disagreements   : ${disagreements.unit_disagreement.length} [${disagreements.unit_disagreement.join(', ')}]`);
    console.log(`Both Miss (FN)       : ${disagreements.both_miss.length} [${disagreements.both_miss.join(', ')}]`);

    console.log('\n--- Comparative Verdict ---');
    const scoreA = computeScore(metricsA);
    const scoreB = computeScore(metricsB);

    if (scoreB > scoreA) {
        console.log('\x1b[32m%s\x1b[0m', 'RESULT: Path B (Forensic) is the SUPERIOR candidate.');
        console.log('Recommendation: Retire Path A for detection, retain only for UI historical summary.');
    } else {
        console.log('\x1b[31m%s\x1b[0m', 'RESULT: Path A (Shallow) performed better or equal.');
        console.log('Recommendation: Path B requires ledger-netting hardening before promotion.');
    }
}

function evaluatePath(scenario: TransferLossScenario, result: PathResult, metrics: EvaluationMetrics) {
    const isPositive = scenario.outcome === 'positive';
    
    if (isPositive) {
        if (result.detected) {
            metrics.tp++;
            const error = result.unresolved_units - scenario.expected_unresolved_units;
            metrics.total_unit_error += Math.abs(error);
            if (error > 0) metrics.overcounts++;
            if (error < 0) metrics.undercounts++;
        } else {
            metrics.fn++;
            metrics.total_unit_error += scenario.expected_unresolved_units;
        }
    } else {
        if (result.detected) {
            metrics.fp++;
            metrics.total_unit_error += result.unresolved_units;
            metrics.overcounts++;
        } else {
            metrics.tn++;
        }
    }
}

function printReport(name: string, m: EvaluationMetrics) {
    const precision = (m.tp + m.fp) > 0 ? (m.tp / (m.tp + m.fp)) * 100 : 100;
    const recall = (m.tp + m.fn) > 0 ? (m.tp / (m.tp + m.fn)) * 100 : 100;
    const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    console.log(`\n--- ${name} Metrics ---`);
    console.log(`Precision: ${precision.toFixed(2)}% | Recall: ${recall.toFixed(2)}% | F1: ${(f1/100).toFixed(2)}`);
    console.log(`TP: ${m.tp} | FP: ${m.fp} | TN: ${m.tn} | FN: ${m.fn}`);
    console.log(`Absolute Unit Error: ${m.total_unit_error}`);
    console.log(`Overcount Instances: ${m.overcounts} | Undercount Instances: ${m.undercounts}`);
}

function computeScore(m: EvaluationMetrics): number {
    const precision = (m.tp + m.fp) > 0 ? m.tp / (m.tp + m.fp) : 1;
    const recall = (m.tp + m.fn) > 0 ? m.tp / (m.tp + m.fn) : 1;
    // Penalty for unit error
    return (precision * 0.4) + (recall * 0.4) - (m.total_unit_error * 0.01);
}

runHarness().catch(console.error);
