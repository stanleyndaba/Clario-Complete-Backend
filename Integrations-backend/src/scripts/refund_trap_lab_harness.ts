/**
 * Refund Trap - Calibration Lab Harness
 * 
 * Metrics Engine for Forensic Investigation (Flagship 5)
 */

import { detectRefundWithoutReturn, RefundSyncedData } from '../services/detection/algorithms/refundAlgorithms';
import { REFUND_TRAP_SCENARIOS, RefundTrapScenario } from './refund_trap_scenarios';

interface LabMetrics {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    absoluteValueError: number;
    overcountInstances: number;
    undercountInstances: number;
    multiUnitFailures: number;
    statusLogicFailures: number;
    currencyFailures: number;
    tenantCollisions: number;
}

const FAILURE_TAXONOMY: Record<string, string[]> = {
    multi_unit_reconciliation_error: [],
    return_status_blindness: [],
    shortfall_math_error: [],
    boundary_window_error: [],
    tenant_isolation_failure: [],
    currency_linkage_fragility: [],
    sku_isolation_failure: []
};

async function runLab() {
    console.log('\x1b[36m%s\x1b[0m', '🧪 [REFUND TRAP] Starting Calibration Lab Harness...');
    console.log('='.repeat(80));

    const metrics: LabMetrics = {
        tp: 0, fp: 0, tn: 0, fn: 0,
        absoluteValueError: 0,
        overcountInstances: 0,
        undercountInstances: 0,
        multiUnitFailures: 0,
        statusLogicFailures: 0,
        currencyFailures: 0,
        tenantCollisions: 0
    };

    for (const scenario of REFUND_TRAP_SCENARIOS) {
        process.stdout.write(`- [${scenario.family}] ${scenario.scenario_id}: `);

        const sellerId = scenario.event_bundle.refund_events[0]?.seller_id || 'DEFAULT-SELLER';
        const syncId = 'LAB-SYNC-' + Date.now();
        
        const data: RefundSyncedData = {
            seller_id: sellerId,
            sync_id: syncId,
            refund_events: scenario.event_bundle.refund_events,
            return_events: scenario.event_bundle.return_events,
            reimbursement_events: scenario.event_bundle.reimbursement_events
        };

        // EXECUTE DETECTOR
        const results = detectRefundWithoutReturn(sellerId, syncId, data);
        
        const isDetected = results.length > 0;
        const totalDetectedValue = results.reduce((sum, r) => sum + r.estimated_value, 0);

        // EVALUATE
        let status = '';
        if (scenario.expected_detector_outcome === 'DETECTION') {
            if (isDetected) {
                metrics.tp++;
                status = '\x1b[32mPASS (TP)\x1b[0m';
            } else {
                metrics.fn++;
                status = '\x1b[31mFAIL (FN)\x1b[0m';
                categorizeFailure(scenario, 'MISS');
            }
        } else {
            if (isDetected) {
                metrics.fp++;
                status = '\x1b[31mFAIL (FP)\x1b[0m';
                categorizeFailure(scenario, 'OVER');
            } else {
                metrics.tn++;
                status = '\x1b[32mPASS (TN)\x1b[0m';
            }
        }

        // VALUE ERRORS
        const expectedValue = scenario.expected_detector_outcome === 'DETECTION' ? scenario.expected_shortfall : 0;
        const valDiff = Math.abs(totalDetectedValue - expectedValue);
        metrics.absoluteValueError += valDiff;
        if (valDiff > 0.01) {
            if (totalDetectedValue > expectedValue) metrics.overcountInstances++;
            else metrics.undercountInstances++;
        }

        // SPECIFIC FAILURES
        if (scenario.family.includes('Multi-unit') && valDiff > 0.01) metrics.multiUnitFailures++;
        if (scenario.family.includes('Status') && !status.includes('PASS')) metrics.statusLogicFailures++;
        if (scenario.family.includes('Currency') && !status.includes('PASS')) metrics.currencyFailures++;
        if (scenario.family.includes('Tenant') && isDetected && scenario.expected_detector_outcome === 'SUPPRESSION') metrics.tenantCollisions++;

        console.log(status + (valDiff > 0.01 ? ` (Val Err: $${valDiff.toFixed(2)})` : ''));
    }

    reportFinalMetrics(metrics);
}

function categorizeFailure(scenario: RefundTrapScenario, type: 'MISS' | 'OVER') {
    const fam = scenario.family.toLowerCase();
    const id = scenario.scenario_id;
    if (fam.includes('multi-unit')) FAILURE_TAXONOMY.multi_unit_reconciliation_error.push(id);
    if (fam.includes('status')) FAILURE_TAXONOMY.return_status_blindness.push(id);
    if (fam.includes('payoff') || fam.includes('shortfall')) FAILURE_TAXONOMY.shortfall_math_error.push(id);
    if (fam.includes('boundary')) FAILURE_TAXONOMY.boundary_window_error.push(id);
    if (fam.includes('tenant')) FAILURE_TAXONOMY.tenant_isolation_failure.push(id);
    if (fam.includes('currency')) FAILURE_TAXONOMY.currency_linkage_fragility.push(id);
    if (fam.includes('sku')) FAILURE_TAXONOMY.sku_isolation_failure.push(id);
}

function reportFinalMetrics(m: LabMetrics) {
    const precision = (m.tp + m.fp) > 0 ? m.tp / (m.tp + m.fp) : 1;
    const recall = (m.tp + m.fn) > 0 ? m.tp / (m.tp + m.fn) : 1;

    console.log('\n' + '='.repeat(80));
    console.log('\x1b[32m%s\x1b[0m', '📊 REFUND TRAP CALIBRATION LAB FINAL REPORT');
    console.log('='.repeat(80));
    console.log(`Precision:            ${(precision * 100).toFixed(2)}%`);
    console.log(`Recall:               ${(recall * 100).toFixed(2)}%`);
    console.log(`Absolute Value Error: $${m.absoluteValueError.toFixed(2)}`);
    console.log(`Overcount Instances:  ${m.overcountInstances}`);
    console.log(`Undercount Instances: ${m.undercountInstances}`);
    console.log('-'.repeat(40));
    console.log(`Multi-Unit Fails:     ${m.multiUnitFailures}`);
    console.log(`Status Logic Fails:   ${m.statusLogicFailures}`);
    console.log(`Currency Fails:       ${m.currencyFailures}`);
    console.log(`Tenant Collisions:    ${m.tenantCollisions}`);
    console.log('='.repeat(80));

    console.log('\x1b[33m%s\x1b[0m', '📍 FAILURE TAXONOMY MAP');
    for (const [key, ids] of Object.entries(FAILURE_TAXONOMY)) {
        if (ids.length > 0) {
            console.log(`- ${key}: ${ids.join(', ')}`);
        }
    }
}

runLab().catch(e => console.error(e));
