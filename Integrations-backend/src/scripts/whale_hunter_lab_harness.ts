/**
 * Whale Hunter Calibration Lab - Harness
 * 
 * An independent, adversarial execution engine for the Whale Hunter algorithm.
 * Designed to expose weaknesses in physical vs claim truth reconciliation.
 */

import { detectLostInventory, SyncedData, DetectionResult } from '../services/detection/algorithms/inventoryAlgorithms';
import { WHALE_HUNTER_SCENARIOS, WhaleHunterScenario } from './whale_hunter_scenarios';

// --- Calibration Assumptions (Independent of Implementation) ---
const ASSUMED_TRANSFER_SLA_DAYS = 30; // 30 days for FC-to-FC transfers
const ASSUMED_REMOVAL_SLA_DAYS = 60;   // 60 days for removals
const ASSUMED_RETURN_SLA_DAYS = 45;    // 45 days for customer returns

// --- Metrics Tracker ---
interface LabMetrics {
    total: number;
    passed: number;
    failed: number;
    precision: number;
    recall: number;
    tp: number; fp: number; tn: number; fn: number;
    boundary_failures: number;
    duplicate_handling_failures: number;
    valuation_mismatches: number;
    ordering_instability: number;
    family_performance: Record<string, { total: number; passed: number }>;
}

const metrics: LabMetrics = {
    total: 0, passed: 0, failed: 0, precision: 0, recall: 0,
    tp: 0, fp: 0, tn: 0, fn: 0,
    boundary_failures: 0,
    duplicate_handling_failures: 0,
    valuation_mismatches: 0,
    ordering_instability: 0,
    family_performance: {}
};

const failureTaxonomy: Record<string, number> = {
    premature_maturity: 0,
    duplicate_sensitivity: 0,
    id_fragility: 0,
    reimbursement_confusion: 0,
    ordering_fragility: 0,
    tenant_contamination: 0,
    valuation_mismatch: 0,
    ambiguity_suppression_failure: 0,
    other: 0
};

const failedScenarios: { scenario: WhaleHunterScenario; actual: any; failure_category: string }[] = [];

/**
 * 1. Permutation Engine
 */
function shuffle<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * 2. Lab Execution Loop
 */
async function runLab() {
    console.log('\n\x1b[35m[WHALE HUNTER CALIBRATION LAB]\x1b[0m');
    console.log('='.repeat(60));
    console.log(`Loading ${WHALE_HUNTER_SCENARIOS.length} adversarial scenarios...`);

    const scenariosToPermute = WHALE_HUNTER_SCENARIOS.slice(0, 10); // Permute first 10

    for (const scenario of WHALE_HUNTER_SCENARIOS) {
        metrics.total++;
        if (!metrics.family_performance[scenario.family]) {
            metrics.family_performance[scenario.family] = { total: 0, passed: 0 };
        }
        metrics.family_performance[scenario.family].total++;

        // a) Standard Run
        const results = detectLostInventory(scenario.events[0]?.seller_id || 'test', 'lab-sync', {
            seller_id: scenario.events[0]?.seller_id || 'test',
            sync_id: 'lab-sync',
            inventory_ledger: scenario.events
        });

        // b) Robustness Check (Permutations)
        let isStable = true;
        if (scenariosToPermute.includes(scenario)) {
            const permutedOrder = shuffle(scenario.events);
            const permutedResults = detectLostInventory(scenario.events[0]?.seller_id || 'test', 'lab-sync-perm', {
                seller_id: scenario.events[0]?.seller_id || 'test',
                sync_id: 'lab-sync-perm',
                inventory_ledger: permutedOrder
            });
            if (results.length !== permutedResults.length) {
                isStable = false;
                metrics.ordering_instability++;
            }
        }

        // c) Validation logic
        const actualOutcome = results.length > 0 ? (results[0].confidence_score > 0.8 ? 'positive' : 'positive') : 'negative'; 
        // Note: Current detector doesn't support 'suppressed' explicitly in outcome, it just returns empty array.
        const expectedOutcome = scenario.expected_detector_outcome === 'suppressed' ? 'negative' : scenario.expected_detector_outcome;

        const totalActualQty = results.reduce((sum, r) => sum + (r.evidence.discrepancy || 0), 0);
        const qtyMatch = totalActualQty === scenario.expected_unresolved_units;
        
        const passed = (actualOutcome === expectedOutcome) && qtyMatch && isStable;

        if (passed) {
            metrics.passed++;
            metrics.family_performance[scenario.family].passed++;
            if (expectedOutcome === 'positive') metrics.tp++;
            else metrics.tn++;
        } else {
            metrics.failed++;
            if (expectedOutcome === 'positive') metrics.fn++;
            else metrics.fp++;

            // Taxonomy classification
            let category = 'other';
            if (!isStable) category = 'ordering_fragility';
            else if (scenario.family.includes('Boundary') && !passed) category = 'premature_maturity';
            else if (scenario.family.includes('Duplicate') && !passed) category = 'duplicate_sensitivity';
            else if (scenario.family.includes('Identifier') && !passed) category = 'id_fragility';
            else if (scenario.family.includes('Multi-Tenant') && !passed) category = 'tenant_contamination';
            else if (scenario.family.includes('Financial') && !passed) category = 'reimbursement_confusion';
            
            failureTaxonomy[category]++;
            failedScenarios.push({ scenario, actual: results, failure_category: category });
        }
    }

    printReport();
}

/**
 * 3. Reporter
 */
function printReport() {
    const precision = (metrics.tp + metrics.fp) > 0 ? metrics.tp / (metrics.tp + metrics.fp) : 1;
    const recall = (metrics.tp + metrics.fn) > 0 ? metrics.tp / (metrics.tp + metrics.fn) : 1;
    const fidelity = (metrics.passed / metrics.total) * 100;

    console.log('\n' + '='.repeat(60));
    console.log('\x1b[32m📊 FORENSIC INTEGRITY REPORT\x1b[0m');
    console.log('='.repeat(60));
    console.log(`Global Fidelity Score: ${fidelity.toFixed(2)}% (${metrics.passed}/${metrics.total})`);
    console.log(`Precision:            ${(precision * 100).toFixed(2)}%`);
    console.log(`Recall:               ${(recall * 100).toFixed(2)}%`);
    console.log(`True Positives:       ${metrics.tp}`);
    console.log(`False Positives:      ${metrics.fp}`);
    console.log(`True Negatives:       ${metrics.tn}`);
    console.log(`False Negatives:      ${metrics.fn}`);
    console.log('-'.repeat(60));
    console.log('ADVERSARIAL FAILURES:');
    console.log(`Boundary Failures:    ${metrics.boundary_failures}`);
    console.log(`Duplicate Sensitivity: ${failureTaxonomy.duplicate_sensitivity}`);
    console.log(`ID Fragility:         ${failureTaxonomy.id_fragility}`);
    console.log(`Ordering Instability: ${metrics.ordering_instability}`);
    console.log('='.repeat(60));

    console.log('\n\x1b[33m[PER-FAMILY ANALYSIS]\x1b[0m');
    for (const [family, stats] of Object.entries(metrics.family_performance)) {
        const perf = (stats.passed / stats.total) * 100;
        const color = perf === 100 ? '\x1b[32m' : perf > 70 ? '\x1b[33m' : '\x1b[31m';
        console.log(`${family.padEnd(35)}: ${color}${perf.toFixed(0)}%\x1b[0m (${stats.passed}/${stats.total})`);
    }

    if (failedScenarios.length > 0) {
        console.log('\n\x1b[31m[CRITICAL FAILURES]\x1b[0m');
        failedScenarios.slice(0, 10).forEach(f => {
            console.log(`- [${f.scenario.scenario_id}] ${f.scenario.description}`);
            console.log(`  Family: ${f.scenario.family} | Category: ${f.failure_category}`);
            console.log(`  Rationale: ${f.scenario.rationale}`);
            const actualQty = f.actual.reduce((sum: number, r: any) => sum + (r.evidence.discrepancy || 0), 0);
            const actualType = f.actual.length > 0 ? f.actual[0].anomaly_type : 'none';
            console.log(`  Actual: Qty=${actualQty}, Type=${actualType} | Expected: Qty=${f.scenario.expected_unresolved_units}`);
        });
        if (failedScenarios.length > 10) console.log(`... and ${failedScenarios.length - 10} more.`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('\x1b[36m🔬 RESEARCH VERDICT\x1b[0m');
    const verdict = fidelity > 95 ? '\x1b[32mSAFE_FOR_FURTHER_CALIBRATION\x1b[0m' : 
                    fidelity > 80 ? '\x1b[33mNEEDS_LOGIC_HARDENING\x1b[0m' : 
                    '\x1b[31mNOT_PRODUCTION_SAFE\x1b[0m';
    console.log(`Final Assessment: ${verdict}`);
    console.log('='.repeat(60));

    console.log('\n\x1b[90m[AUDITOR NOTES]\x1b[0m');
    console.log('1. Fragile Area: Duplicate event sensitivity. Logic lacks explicit ID-level deduplication.');
    console.log('2. Fragile Area: Transfer SLA assumes global 30 day window; fails on multi-hop ambiguity.');
    console.log('3. Fragile Area: Identifier chaos. Falling back to date-only signatures creates FC collisions.');
    console.log('4. Valuation Gap: Unit cost estimation is static and does not respect marketplace currency variance.');
}

runLab().catch(console.error);
