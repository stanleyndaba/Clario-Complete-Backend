/**
 * Broken Goods Hunter - Calibration Lab Harness
 * 
 * Metrics Engine for Forensic Investigation
 */

import { detectDamagedInventory, DamagedSyncedData } from '../services/detection/algorithms/damagedAlgorithms';
import { BROKEN_GOODS_SCENARIOS, BrokenGoodsScenario } from './broken_goods_scenarios';

interface LabMetrics {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    absoluteUnitError: number;
    totalExpectedUnits: number;
    totalDetectedUnits: number;
    overcountInstances: number;
    undercountInstances: number;
    dedupFailures: number;
    reimbLinkageFailures: number;
    physicalRecoveryFailures: number;
    valuationFailures: number;
    tenantCollisions: number;
}

const FAILURE_TAXONOMY: Record<string, string[]> = {
    duplicate_damage_inflation: [],
    reimbursement_linkage_fragility: [],
    physical_recovery_blindness: [],
    generic_adjustment_recovery_miss: [],
    transfer_damage_attribution_confusion: [],
    tenant_contamination: [],
    valuation_default_mismatch: [],
    maturity_boundary_error: []
};

async function runLab() {
    console.log('\x1b[36m%s\x1b[0m', '🧪 [BROKEN GOODS] Starting Calibration Lab Harness...');
    console.log('='.repeat(80));

    const metrics: LabMetrics = {
        tp: 0, fp: 0, tn: 0, fn: 0,
        absoluteUnitError: 0,
        totalExpectedUnits: 0,
        totalDetectedUnits: 0,
        overcountInstances: 0,
        undercountInstances: 0,
        dedupFailures: 0,
        reimbLinkageFailures: 0,
        physicalRecoveryFailures: 0,
        valuationFailures: 0,
        tenantCollisions: 0
    };

    for (const scenario of BROKEN_GOODS_SCENARIOS) {
        process.stdout.write(`- [${scenario.family}] ${scenario.scenario_id}: `);

        const sellerId = scenario.event_bundle.inventory_ledger[0]?.seller_id || 'DEFAULT-SELLER';
        const syncId = 'LAB-SYNC-' + Date.now();
        
        const data: DamagedSyncedData = {
            seller_id: sellerId,
            sync_id: syncId,
            inventory_ledger: scenario.event_bundle.inventory_ledger,
            reimbursement_events: scenario.event_bundle.reimbursement_events
        };

        // EXECUTE DETECTOR
        const results = detectDamagedInventory(sellerId, syncId, data);
        
        const isDetected = results.length > 0;
        const totalDetectedUnits = results.reduce((sum, r) => sum + (r.evidence.quantity_damaged || 0), 0); // Note: current evidence structure
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

        // UNIT ERRORS
        const unitDiff = Math.abs(totalDetectedUnits - (scenario.expected_detector_outcome === 'DETECTION' ? scenario.expected_damaged_units : 0));
        metrics.absoluteUnitError += unitDiff;
        if (unitDiff > 0) {
            if (totalDetectedUnits > scenario.expected_damaged_units) metrics.overcountInstances++;
            else metrics.undercountInstances++;
        }

        // SPECIFIC FAILURES
        const expectedUnitCount = scenario.expected_detector_outcome === 'DETECTION' ? scenario.expected_damaged_units : 0;
        if (scenario.family.includes('Duplicate') && totalDetectedUnits > expectedUnitCount) metrics.dedupFailures++;
        if (scenario.family.includes('Tenant') && isDetected) metrics.tenantCollisions++;
        if (scenario.family.includes('Valuation') && Math.abs(totalDetectedValue - scenario.expected_claimable_units_or_value) > 1) metrics.valuationFailures++;

        console.log(status + (unitDiff > 0 ? ` (Unit Err: ${unitDiff})` : ''));
    }

    reportFinalMetrics(metrics);
}

function categorizeFailure(scenario: BrokenGoodsScenario, type: 'MISS' | 'OVER') {
    const fam = scenario.family.toLowerCase();
    if (fam.includes('duplicate')) FAILURE_TAXONOMY.duplicate_damage_inflation.push(scenario.scenario_id);
    if (fam.includes('partial') || fam.includes('reimbursement')) FAILURE_TAXONOMY.reimbursement_linkage_fragility.push(scenario.scenario_id);
    if (fam.includes('found')) FAILURE_TAXONOMY.physical_recovery_blindness.push(scenario.scenario_id || 'F-MISS');
    if (fam.includes('generic')) FAILURE_TAXONOMY.generic_adjustment_recovery_miss.push(scenario.scenario_id);
    if (fam.includes('transfer')) FAILURE_TAXONOMY.transfer_damage_attribution_confusion.push(scenario.scenario_id);
    if (fam.includes('tenant')) FAILURE_TAXONOMY.tenant_contamination.push(scenario.scenario_id);
    if (fam.includes('valuation')) FAILURE_TAXONOMY.valuation_default_mismatch.push(scenario.scenario_id);
    if (fam.includes('boundary')) FAILURE_TAXONOMY.maturity_boundary_error.push(scenario.scenario_id);
}

function reportFinalMetrics(m: LabMetrics) {
    const precision = (m.tp + m.fp) > 0 ? m.tp / (m.tp + m.fp) : 1;
    const recall = (m.tp + m.fn) > 0 ? m.tp / (m.tp + m.fn) : 1;

    console.log('\n' + '='.repeat(80));
    console.log('\x1b[32m%s\x1b[0m', '📊 BROKEN GOODS CALIBRATION LAB FINAL REPORT');
    console.log('='.repeat(80));
    console.log(`Precision:            ${(precision * 100).toFixed(2)}%`);
    console.log(`Recall:               ${(recall * 100).toFixed(2)}%`);
    console.log(`Absolute Unit Error:  ${m.absoluteUnitError}`);
    console.log(`Overcount Instances:  ${m.overcountInstances}`);
    console.log(`Undercount Instances: ${m.undercountInstances}`);
    console.log('-'.repeat(40));
    console.log(`Deduplication Fails:  ${m.dedupFailures}`);
    console.log(`Linkage Fails:        ${m.reimbLinkageFailures}`);
    console.log(`Recovery Fails:       ${m.physicalRecoveryFailures}`);
    console.log(`Valuation Fails:      ${m.valuationFailures}`);
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
