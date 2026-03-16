/**
 * Inbound Inspector Calibration Lab Harness
 * 
 * Version: 1.0 (Flagship 3)
 */

import { detectInboundAnomalies } from '../services/detection/algorithms/inboundAlgorithms';
import { INBOUND_SCENARIOS } from './inbound_scenarios';

async function runInboundLab() {
    console.log('\x1b[36m%s\x1b[0m', '🔬 Starting Inbound Inspector Calibration Lab...');
    console.log(`Running ${INBOUND_SCENARIOS.length} adversarial scenarios...\n`);

    let tp = 0, fp = 0, tn = 0, fn = 0;
    let totalUnitError = 0;
    let overcountInstances = 0;
    let undercountInstances = 0;
    let reimbNettingFailures = 0;
    let maturityBoundaryFailures = 0;
    let receivingLimboFailures = 0;

    const failureTaxonomy: Record<string, number> = {
        reimbursement_boolean_suppression: 0,
        maturity_boundary_error: 0,
        receiving_limbo_blindness: 0,
        duplicate_sensitivity: 0,
        shipment_id_fragility: 0,
        carton_case_precision_failure: 0,
        tenant_contamination: 0,
        valuation_mismatch: 0
    };

    for (const scenario of INBOUND_SCENARIOS) {
        // Execute detector
        const results = detectInboundAnomalies(scenario.shipment_items[0].seller_id, 'lab-sync-id', {
            seller_id: scenario.shipment_items[0].seller_id,
            sync_id: 'lab-sync-id',
            inbound_shipment_items: scenario.shipment_items,
            reimbursement_events: scenario.reimbursements
        });

        // Compute detected units
        const detectedUnits = results.reduce((sum, r) => {
            // Priority 1: claimable_units (standard)
            if (r.evidence.claimable_units !== undefined) {
                return sum + r.evidence.claimable_units;
            }
            // Priority 2: Legacy fields
            if (r.anomaly_type === 'shipment_missing') {
                return sum + (r.evidence.total_shipped || 0);
            }
            if (r.anomaly_type === 'shipment_shortage' || r.anomaly_type === 'receiving_error' || r.anomaly_type === 'case_break_error') {
                return sum + (r.evidence.shortage || 0);
            }
            if (r.anomaly_type === 'carrier_damage') {
                return sum + (r.evidence.damaged_qty || 0);
            }
            return sum;
        }, 0);

        const isPositive = results.length > 0;
        const shouldBePositive = scenario.outcome === 'positive';
        
        // Metrics logic
        if (shouldBePositive) {
            if (isPositive) tp++;
            else fn++;
        } else {
            if (isPositive) fp++;
            else tn++;
        }

        // Unit accuracy
        const unitError = Math.abs(detectedUnits - scenario.expected_claimable_units);
        totalUnitError += unitError;

        if (detectedUnits > scenario.expected_claimable_units) overcountInstances++;
        if (detectedUnits < scenario.expected_claimable_units && shouldBePositive) undercountInstances++;

        // Taxonomy Analysis
        if (scenario.family.includes('Partial Reimb') && !isPositive && shouldBePositive) {
            failureTaxonomy.reimbursement_boolean_suppression++;
            reimbNettingFailures++;
        }
        if (scenario.family.includes('Boundaries') && isPositive && !shouldBePositive) {
            failureTaxonomy.maturity_boundary_error++;
            maturityBoundaryFailures++;
        }
        if (scenario.family.includes('Limbo') && !isPositive && shouldBePositive) {
            failureTaxonomy.receiving_limbo_blindness++;
            receivingLimboFailures++;
        }
        if (scenario.family.includes('Duplicates') && detectedUnits !== scenario.expected_claimable_units) {
            failureTaxonomy.duplicate_sensitivity++;
        }
        if (scenario.family.includes('Linkage') && detectedUnits !== scenario.expected_claimable_units) {
            failureTaxonomy.shipment_id_fragility++;
        }
        if (scenario.family.includes('Case-break') && detectedUnits !== scenario.expected_claimable_units) {
            failureTaxonomy.carton_case_precision_failure++;
        }
        if (scenario.family.includes('Tenant') && isPositive && scenario.shipment_items.some(i => i.seller_id !== scenario.shipment_items[0].seller_id)) {
             // Basic tenant leakage check
        }

        // Detailed log for failures
        if (isPositive !== shouldBePositive || unitError > 0) {
            const status = isPositive !== shouldBePositive ? '\x1b[31m[STATE_ERR]\x1b[0m' : '\x1b[33m[UNIT_ERR]\x1b[0m';
            console.log(`${status} ${scenario.id}: Exp ${scenario.expected_claimable_units}, Got ${detectedUnits} (${scenario.family})`);
        }
    }

    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;

    console.log('\n' + '='.repeat(60));
    console.log('\x1b[32m%s\x1b[0m', '📊 INBOUND INSPECTOR CALIBRATION LAB REPORT');
    console.log('='.repeat(60));
    console.log(`Precision:            ${(precision * 100).toFixed(2)}%`);
    console.log(`Recall:               ${(recall * 100).toFixed(2)}%`);
    console.log(`Absolute Unit Error:  ${totalUnitError}`);
    console.log(`Overcount Instances:  ${overcountInstances}`);
    console.log(`Undercount Instances: ${undercountInstances}`);
    console.log('-'.repeat(60));
    console.log('FAILURE TAXONOMY:');
    Object.entries(failureTaxonomy).forEach(([key, value]) => {
        if (value > 0) console.log(`- ${key}: ${value}`);
    });
    console.log('-'.repeat(60));
    console.log(`Reimb Netting Failures:    ${reimbNettingFailures}`);
    console.log(`Maturity Boundary Failures: ${maturityBoundaryFailures}`);
    console.log(`Receiving Limbo Failures:  ${receivingLimboFailures}`);
    console.log('='.repeat(60));

    if (precision < 1 || recall < 1 || totalUnitError > 0) {
        console.log('\x1b[31m%s\x1b[0m', '\nVERDICT: CALIBRATION FAILED (Baseline Unsafe)');
    } else {
        console.log('\x1b[32m%s\x1b[0m', '\nVERDICT: CALIBRATION PASSED (Golden Profile)');
    }
}

runInboundLab().catch(console.error);
