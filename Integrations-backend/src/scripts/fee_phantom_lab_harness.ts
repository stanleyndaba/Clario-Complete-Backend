/**
 * Fee Phantom Lab Harness
 * 
 * Production-grade adversarial calibration lab for Flagship 6: Fee Phantom.
 * Computes Precision, Recall, Absolute Value Error, and Failure Taxonomy.
 */

import { detectAllFeeOvercharges } from '../services/detection/algorithms/feeAlgorithms';
import { detectFeeMisclassification } from '../services/detection/algorithms/feeMisclassificationAlgorithm';
import { generateAllScenarios, FeeScenario } from './fee_phantom_scenarios';
import * as fs from 'fs';
import * as path from 'path';

const MOCK_SELLER_ID = 'fee-phantom-tester';
const MOCK_SYNC_ID = 'bench-sync-999';
const GOLDEN_SNAPSHOT_FILE = path.join(__dirname, 'golden_baseline.json');
const IS_SAVE_MODE = process.argv.includes('--save-golden');

// Failure Taxonomy Categories
type FailureCategory =
    | 'usd_only_assumption'
    | 'marketplace_physics_mismatch'
    | 'dimensional_tier_misclassification'
    | 'storage_fee_logic_error'
    | 'low_inventory_fee_placeholder'
    | 'return_processing_fee_placeholder'
    | 'duplicate_fee_inflation'
    | 'missing_credit_or_reversal'
    | 'tenant_contamination'
    | 'versioning_boundary_error'
    | 'other';

interface ScenarioResultRecord {
    scenario_id: string;
    expected_positive: boolean;
    actual_positive: boolean;
    outcome_label: 'TP' | 'TN' | 'FP' | 'FN';
    failure_family: string;
    value_match_status: 'matching' | 'mismatch' | 'n/a';
    expected_value: number;
    actual_value: number;
}

interface Metrics {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    absoluteValueError: number;
    overchargeAccuracy: number;
    taxonomy: Record<FailureCategory, number>;
}

async function runLab() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting Fee Phantom Adversarial Calibration Lab (Audit Mode)...');
    console.log('================================================================');

    const scenarios = generateAllScenarios();
    const metrics: Metrics = {
        tp: 0, fp: 0, tn: 0, fn: 0,
        absoluteValueError: 0,
        overchargeAccuracy: 0,
        taxonomy: {
            usd_only_assumption: 0,
            marketplace_physics_mismatch: 0,
            dimensional_tier_misclassification: 0,
            storage_fee_logic_error: 0,
            low_inventory_fee_placeholder: 0,
            return_processing_fee_placeholder: 0,
            duplicate_fee_inflation: 0,
            missing_credit_or_reversal: 0,
            tenant_contamination: 0,
            versioning_boundary_error: 0,
            other: 0
        }
    };

    let goldenBaseline: Record<string, { label: string, actual_value: number }> | null = null;
    if (!IS_SAVE_MODE && fs.existsSync(GOLDEN_SNAPSHOT_FILE)) {
        goldenBaseline = JSON.parse(fs.readFileSync(GOLDEN_SNAPSHOT_FILE, 'utf-8'));
    }

    const rawResultTable: ScenarioResultRecord[] = [];
    let shieldFails = 0;
    let schemaErrors = 0;

    for (const scenario of scenarios) {
        process.stdout.write(`Evaluating [${scenario.id}] ${scenario.family.padEnd(45)}... `);

        // 1. Prepare Data
        const feeSyncedData = {
            seller_id: MOCK_SELLER_ID,
            sync_id: MOCK_SYNC_ID,
            fee_events: scenario.fee_events,
            product_catalog: scenario.product_catalog
        };

        const feeMisclassSyncedData = {
            seller_id: MOCK_SELLER_ID,
            sync_id: MOCK_SYNC_ID,
            dimensions: scenario.product_catalog.map(p => ({
                sku: p.sku,
                length: p.length_in || 0,
                width: p.width_in || 0,
                height: p.height_in || 0,
                weight_oz: p.weight_oz || 0,
                asin: p.asin,
                source: 'catalog'
            })),
            fee_transactions: scenario.fee_events.map(e => ({
                id: e.id,
                seller_id: e.seller_id,
                transaction_date: e.fee_date,
                sku: e.sku,
                fee_type: e.fee_type,
                fee_amount: Math.abs(e.fee_amount),
                currency: e.currency,
                stated_size_tier: e.stated_size_tier,
                quantity: 1
            }))
        };

        // 2. Run Detectors
        const auditorResults = detectAllFeeOvercharges(MOCK_SELLER_ID, MOCK_SYNC_ID, feeSyncedData as any);
        const misclassResults = await detectFeeMisclassification(MOCK_SELLER_ID, MOCK_SYNC_ID, feeMisclassSyncedData as any);
        
        const combinedResults = [...auditorResults, ...misclassResults];

        // 3. Compare with Ground Truth and Aggregate
        const record = analyzeScenario(scenario, combinedResults, metrics);
        rawResultTable.push(record);

        if (!evaluateRegressionShields(record, scenario, goldenBaseline)) {
            shieldFails++;
            (metrics as any).shieldFails = shieldFails;
        }
    }

    if (IS_SAVE_MODE) {
        const newGolden: Record<string, { label: string, actual_value: number }> = {};
        rawResultTable.forEach(r => {
            newGolden[r.scenario_id] = { label: r.outcome_label, actual_value: r.actual_value };
        });
        fs.writeFileSync(GOLDEN_SNAPSHOT_FILE, JSON.stringify(newGolden, null, 2));
        console.log(`\n\x1b[32m[SAVED] Golden baseline saved to ${GOLDEN_SNAPSHOT_FILE} with ${rawResultTable.length} scenarios.\x1b[0m`);
    }

    // 4. Trace and Verify Aggregation Integrity
    verifyHarnessIntegrity(rawResultTable, metrics, scenarios.length);

    // 5. Final Report
    printFinalReport(metrics, scenarios.length);
}

function analyzeScenario(scenario: FeeScenario, results: any[], metrics: Metrics): ScenarioResultRecord {
    const expected = scenario.expected_results;
    
    const hasExpected = expected.length > 0;
    const hasActual = results.length > 0;

    let label: 'TP' | 'TN' | 'FP' | 'FN' = 'TN';
    if (hasExpected && hasActual) label = 'TP';
    else if (!hasExpected && !hasActual) label = 'TN';
    else if (!hasExpected && hasActual) label = 'FP';
    else if (hasExpected && !hasActual) label = 'FN';

    const expectedVal = expected.reduce((sum, r) => sum + r.estimated_value, 0);
    const actualVal = results.reduce((sum, r) => sum + (r.estimated_value || r.total_overcharge || 0), 0);
    const valError = Math.abs(expectedVal - actualVal);
    
    let valueStatus: 'matching' | 'mismatch' | 'n/a' = 'n/a';

    // Schema Stability Tests
    let isSchemaStable = true;
    results.forEach(r => {
        if (!r.evidence.explanation || !r.evidence.cohort_trace_graph || !r.confidence_band) {
            console.error(`\x1b[31m[SCHEMA ERROR] Scenario ${scenario.id} missing mandatory observability fields.\x1b[0m`);
            isSchemaStable = false;
        } else {
            const exp = r.evidence.explanation;
            if (exp.expected_fee === null || exp.observed_fee === null || exp.recoverable_delta === null || !exp.valuation_owner) {
                console.error(`\x1b[31m[SCHEMA ERROR] Scenario ${scenario.id} explanation has null required fields.\x1b[0m`);
                isSchemaStable = false;
            }
        }
    });

    if (!isSchemaStable) (metrics as any).schemaErrors = ((metrics as any).schemaErrors || 0) + 1;

    if (label === 'TP') {
        metrics.tp++;
        console.log('\x1b[32mPASS (TP)\x1b[0m');
        metrics.absoluteValueError += valError;
        if (valError > 0.05) {
            console.log(`  - \x1b[33mValue Mismatch:\x1b[0m Expected $${expectedVal.toFixed(2)}, Found $${actualVal.toFixed(2)}`);
            metrics.overchargeAccuracy++;
            valueStatus = 'mismatch';
        } else {
            valueStatus = 'matching';
        }
    } else if (label === 'TN') {
        metrics.tn++;
        console.log('\x1b[32mPASS (TN)\x1b[0m');
    } else if (label === 'FP') {
        metrics.fp++;
        console.log('\x1b[31mFAIL (FP)\x1b[0m');
        categorizeFailure(scenario, 'FP', metrics);
    } else if (label === 'FN') {
        metrics.fn++;
        console.log('\x1b[31mFAIL (FN)\x1b[0m');
        categorizeFailure(scenario, 'FN', metrics);
    }

    return {
        scenario_id: scenario.id,
        expected_positive: hasExpected,
        actual_positive: hasActual,
        outcome_label: label,
        failure_family: scenario.family,
        value_match_status: valueStatus,
        expected_value: expectedVal,
        actual_value: actualVal
    };
}

function evaluateRegressionShields(record: ScenarioResultRecord, scenario: FeeScenario, goldenBaseline: Record<string, { label: string, actual_value: number }> | null): boolean {
    if (!goldenBaseline || !goldenBaseline[scenario.id]) return true; // Not in baseline, so no shield
    
    const golden = goldenBaseline[scenario.id];
    let pass = true;
    
    // 1. Classification Shield
    if (golden.label !== record.outcome_label) {
        console.error(`\x1b[31m    -> [SHIELD FATAL] ${scenario.id} classification shifted from ${golden.label} to ${record.outcome_label}\x1b[0m`);
        pass = false;
    }
    
    // 2. Valuation Shield (Exact lock by default, bounded tolerance for approximate)
    const valDiff = Math.abs(golden.actual_value - record.actual_value);
    if (valDiff > 0) {
        if ((scenario as any).expected_value_status === 'approximate' && valDiff <= 0.15) {
            // Tolerated rounding bound
        } else {
            console.error(`\x1b[31m    -> [SHIELD FATAL] ${scenario.id} valuation shifted from ${golden.actual_value.toFixed(2)} to ${record.actual_value.toFixed(2)}\x1b[0m`);
            pass = false;
        }
    }
    
    return pass;
}

function categorizeFailure(scenario: FeeScenario, type: 'FP' | 'FN', metrics: Metrics) {
    let category: FailureCategory = 'other';

    if (scenario.id.startsWith('F7')) category = 'marketplace_physics_mismatch';
    else if (scenario.id.startsWith('F8')) category = 'usd_only_assumption';
    else if (scenario.id.startsWith('F11')) category = 'duplicate_fee_inflation';
    else if (scenario.id.startsWith('F12')) category = 'tenant_contamination';
    else if (scenario.id.startsWith('F6')) category = 'dimensional_tier_misclassification';
    else if (scenario.id.startsWith('F9')) category = 'low_inventory_fee_placeholder';
    else if (scenario.id.startsWith('F10')) category = 'return_processing_fee_placeholder';
    else if (scenario.id.startsWith('F13')) category = 'missing_credit_or_reversal';
    else if (scenario.id.startsWith('F14')) category = 'versioning_boundary_error';
    else if (scenario.family.includes('storage')) category = 'storage_fee_logic_error';

    metrics.taxonomy[category]++;
}

function verifyHarnessIntegrity(table: ScenarioResultRecord[], metrics: Metrics, totalEvaluated: number) {
    console.log('\n--- HARNESS INTEGRITY AUDIT ---');
    
    // Recompute from table
    const recomputed = {
        tp: table.filter(r => r.outcome_label === 'TP').length,
        tn: table.filter(r => r.outcome_label === 'TN').length,
        fp: table.filter(r => r.outcome_label === 'FP').length,
        fn: table.filter(r => r.outcome_label === 'FN').length,
        valErrors: table.filter(r => r.value_match_status === 'mismatch').length
    };

    const checks = [
        { name: 'TP Consistency', pass: recomputed.tp === metrics.tp, detail: `Recomputed: ${recomputed.tp}, Metrics: ${metrics.tp}` },
        { name: 'TN Consistency', pass: recomputed.tn === metrics.tn, detail: `Recomputed: ${recomputed.tn}, Metrics: ${metrics.tn}` },
        { name: 'FP Consistency', pass: recomputed.fp === metrics.fp, detail: `Recomputed: ${recomputed.fp}, Metrics: ${metrics.fp}` },
        { name: 'FN Consistency', pass: recomputed.fn === metrics.fn, detail: `Recomputed: ${recomputed.fn}, Metrics: ${metrics.fn}` },
        { name: 'Val Consistency', pass: recomputed.valErrors === metrics.overchargeAccuracy, detail: `Recomputed: ${recomputed.valErrors}, Metrics: ${metrics.overchargeAccuracy}` },
        { name: 'Scenario Coverage', pass: table.length === totalEvaluated, detail: `Table: ${table.length}, Evaluated: ${totalEvaluated}` },
        { name: 'Universe Integrity', pass: (metrics.tp + metrics.tn + metrics.fp + metrics.fn) === totalEvaluated, detail: `Sum: ${metrics.tp + metrics.tn + metrics.fp + metrics.fn}, Total: ${totalEvaluated}` }
    ];

    let allPass = true;
    checks.forEach(c => {
        if (c.pass) {
            console.log(`[PASS] ${c.name}: ${c.detail}`);
        } else {
            console.log(`[FAIL] ${c.name}: ${c.detail}`);
            allPass = false;
        }
    });

    if (!allPass) {
        console.error('\x1b[31mCRITICAL: Harness Aggregation Mismatch Detected!\x1b[0m');
        // No exit(1) yet, I want to see the report first even if it fails
    }
}

function printFinalReport(m: Metrics, total: number) {
    const precision = (m.tp + m.fp) > 0 ? (m.tp / (m.tp + m.fp)) * 100 : 0;
    const recall = (m.tp + m.fn) > 0 ? (m.tp / (m.tp + m.fn)) * 100 : 0;

    console.log('\n' + '='.repeat(64));
    console.log('\x1b[32m%s\x1b[0m', '📊 FEE PHANTOM CALIBRATION LAB FINAL METRICS');
    console.log('='.repeat(64));
    console.log(`Scenarios Evaluated:     ${total}`);
    console.log(`True Positives (TP):     ${m.tp}`);
    console.log(`True Negatives (TN):     ${m.tn}`);
    console.log(`False Positives (FP):    ${m.fp}`);
    console.log(`False Negatives (FN):    ${m.fn}`);
    console.log('-'.repeat(64));
    console.log(`Precision:               \x1b[35m${precision.toFixed(2)}%\x1b[0m`);
    console.log(`Recall:                  \x1b[35m${recall.toFixed(2)}%\x1b[0m`);
    console.log(`Absolute Value Error:    \x1b[31m$${m.absoluteValueError.toFixed(2)}\x1b[0m`);
    console.log(`Value Accuracy Fails:    ${m.overchargeAccuracy}`);
    console.log('-'.repeat(64));
    console.log('--- FAILURE TAXONOMY ---');
    Object.entries(m.taxonomy).forEach(([cat, count]) => {
        if (count > 0) {
            console.log(`${cat.padEnd(35)}: ${count}`);
        }
    });
    console.log('='.repeat(64));
    
    
    if ((m as any).shieldFails > 0 || (m as any).schemaErrors > 0) {
        console.log('\x1b[31m%s\x1b[0m', `🚨 VERDICT: SYSTEM UNSTABLE. [SHIELDS BROKEN: ${(m as any).shieldFails}] [SCHEMA ERRORS: ${(m as any).schemaErrors}]`);
    } else if (precision < 100 || recall < 100) {
        console.log('\x1b[33m%s\x1b[0m', '⚠️ VERDICT: SYSTEM STABLE BUT RECALL < 100%.');
    } else {
        console.log('\x1b[32m%s\x1b[0m', '✅ VERDICT: GOLDEN PROFILE ACHIEVED.');
    }
}

runLab().catch(console.error);
