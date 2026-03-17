import { detectDuplicateMissedReimbursements, SentinelAnomalyType, SentinelDetectionResult } from '../services/detection/algorithms/duplicateMissedReimbursementAlgorithm';
import { SENTINEL_LAB_SCENARIOS, SentinelScenario } from './sentinel_scenarios';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface LabMetrics {
    total_scenarios: number;
    true_positives: number;
    true_negatives: number;
    false_positives: number;
    false_negatives: number;
    precision: number;
    recall: number;
    total_expected_value_delta: number;
    total_actual_value_delta: number;
    absolute_value_error: number;
    value_accuracy_fails: number;
}

interface FailureTaxonomy {
    family: string;
    fp_count: number;
    fn_count: number;
    value_error_sum: number;
    failing_scenarios: string[];
}

// ============================================================================
// Harness Runner
// ============================================================================

async function runSentinelLab() {
    console.log('\n🧪 [SENTINEL LAB] Starting Phase 2 Adversarial Baseline Run...\n');

    let tp = 0, tn = 0, fp = 0, fn = 0;
    let totalExpectedValue = 0;
    let totalActualValue = 0;
    let absoluteValueErrorSum = 0;
    let valueAccuracyFails = 0;

    const taxonomy = new Map<string, FailureTaxonomy>();

    for (const scenario of SENTINEL_LAB_SCENARIOS) {
        // Initialize taxonomy tracking
        if (!taxonomy.has(scenario.family)) {
            taxonomy.set(scenario.family, {
                family: scenario.family,
                fp_count: 0,
                fn_count: 0,
                value_error_sum: 0,
                failing_scenarios: []
            });
        }

        // Run detector
        const results = await detectDuplicateMissedReimbursements(
            scenario.data.seller_id,
            scenario.data.sync_id,
            scenario.data
        );

        // Analyze Results
        const actualHasAnomaly = results.length > 0;
        const expectedHasAnomaly = scenario.expected_results.has_anomaly;
        let actualValueDelta = 0;
        let detectedTypes = new Set<string>();

        for (const res of results) {
            detectedTypes.add(res.detection_type);
            // Some detectors output positive recovery, some output clawback logic based on type.
            if (res.detection_type === 'missed_reimbursement' || res.detection_type === 'ASYMMETRIC_CLAWBACK' || res.detection_type === 'GHOST_REVERSAL') {
                actualValueDelta += res.estimated_recovery;
            } else if (res.detection_type === 'duplicate_reimbursement' || res.detection_type === 'clawback_risk') {
                actualValueDelta += res.clawback_risk_value;
            }
        }

        const expectedValueDelta = scenario.expected_results.expected_value_delta || 0;
        const valueError = Math.abs(expectedValueDelta - actualValueDelta);

        // Classification Bucket Math
        let isFP = false;
        let isFN = false;

        if (expectedHasAnomaly && actualHasAnomaly) {
            tp++;
        } else if (!expectedHasAnomaly && !actualHasAnomaly) {
            tn++;
        } else if (!expectedHasAnomaly && actualHasAnomaly) {
            fp++;
            isFP = true;
        } else if (expectedHasAnomaly && !actualHasAnomaly) {
            fn++;
            isFN = true;
        }

        // Value Check
        if (expectedHasAnomaly && valueError > 0.05) {
            valueAccuracyFails++;
            // Treat value failure as a structural failure for the taxonomy mapping.
            const tax = taxonomy.get(scenario.family)!;
            tax.value_error_sum += valueError;
            if(!tax.failing_scenarios.includes(scenario.id)) tax.failing_scenarios.push(scenario.id);
        }

        // Update tracking
        totalExpectedValue += expectedValueDelta;
        totalActualValue += actualValueDelta;
        absoluteValueErrorSum += valueError;

        if (isFP || isFN) {
            const tax = taxonomy.get(scenario.family)!;
            if (isFP) tax.fp_count++;
            if (isFN) tax.fn_count++;
            if(!tax.failing_scenarios.includes(scenario.id)) tax.failing_scenarios.push(scenario.id);
        }
    }

    const precision = (tp + fp) === 0 ? 0 : (tp / (tp + fp)) * 100;
    const recall = (tp + fn) === 0 ? 0 : (tp / (tp + fn)) * 100;
    const avgAve = absoluteValueErrorSum / SENTINEL_LAB_SCENARIOS.length;

    console.log('====================================================');
    console.log('                 LAB METRICS                        ');
    console.log('====================================================');
    console.log(`Total Scenarios: ${SENTINEL_LAB_SCENARIOS.length}`);
    console.log(`True Positives (TP):  ${tp}`);
    console.log(`True Negatives (TN):  ${tn}`);
    console.log(`False Positives (FP): ${fp}  <-- FATAL RISK`);
    console.log(`False Negatives (FN): ${fn}`);
    console.log('----------------------------------------------------');
    console.log(`Precision:            ${precision.toFixed(2)}%`);
    console.log(`Recall:               ${recall.toFixed(2)}%`);
    console.log(`Absolute Value Error: $${avgAve.toFixed(2)} per scenario`);
    console.log(`Value Accuracy Fails: ${valueAccuracyFails}`);
    console.log('====================================================');

    console.log('\n====================================================');
    console.log('               FAILURE TAXONOMY                     ');
    console.log('====================================================');
    for (const [family, tax] of taxonomy) {
        if (tax.fp_count > 0 || tax.fn_count > 0 || tax.value_error_sum > 0) {
            console.log(`\nFamily: ${family}`);
            console.log(`  FP: ${tax.fp_count} | FN: ${tax.fn_count} | AVE: $${tax.value_error_sum.toFixed(2)}`);
            console.log(`  Failing Scenarios: ${tax.failing_scenarios.join(', ')}`);
        }
    }

    const verdict = (precision === 100 && avgAve < 0.1) ? 'SAFE FOR PRODUCTION - FROZEN' : 'CATASTROPHIC BASELINE FAILURE - REQUIRES HARDENING';
    
    console.log('\n====================================================');
    console.log(`PRODUCTION VERDICT: ${verdict}`);
    console.log('====================================================\n');

    generateBaselineReport(tp, tn, fp, fn, precision, recall, avgAve, valueAccuracyFails, Array.from(taxonomy.values()), verdict);
}

function generateBaselineReport(tp: number, tn: number, fp: number, fn: number, precision: number, recall: number, avgAve: number, valueFails: number, taxonomy: FailureTaxonomy[], verdict: string) {
    let report = `# Sentinel Calibration Lab: Baseline Run Report

## Executive Summary
This report documents the un-hardened baseline execution of Agent 3 Flagship 7: The Sentinel against a deterministic adversarial scenario suite containing ${SENTINEL_LAB_SCENARIOS.length} scenarios.

**Verdict:** ${verdict}

## Global Metrics
- **True Positives (TP):** ${tp}
- **True Negatives (TN):** ${tn}
- **False Positives (FP):** ${fp}
- **False Negatives (FN):** ${fn}
- **Precision:** ${precision.toFixed(2)}%
- **Recall:** ${recall.toFixed(2)}%
- **Absolute Value Error (AVE):** $${avgAve.toFixed(2)}
- **Value Accuracy Fails:** ${valueFails}

## Failure Taxonomy & Structural Weaknesses

`;

    for (const tax of taxonomy) {
        if (tax.fp_count > 0 || tax.fn_count > 0 || tax.value_error_sum > 0) {
            report += `### ${tax.family}\n`;
            report += `- **False Positives:** ${tax.fp_count}\n`;
            report += `- **False Negatives:** ${tax.fn_count}\n`;
            report += `- **Failing Scenarios:** ${tax.failing_scenarios.join(', ')}\n\n`;
        }
    }

    const reportPath = path.join(__dirname, '..', '..', '..', '..', '.gemini', 'antigravity', 'brain', '5401a277-deb6-4bb3-bb77-8c28747e7c56', 'sentinel_baseline_report.md');
    try {
      fs.writeFileSync(reportPath, report);
      console.log(`Baseline report written to: ${reportPath}`);
    } catch(e) {
      console.log('Failed to write baseline report to artifact dir. Check paths.', e);
    }
}

// Execute if run directly
if (require.main === module) {
    runSentinelLab().catch(e => {
        console.error('Fatal Lab crash:', e);
        process.exit(1);
    });
}
