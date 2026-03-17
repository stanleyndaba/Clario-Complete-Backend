import { SENTINEL_LAB_SCENARIOS } from './sentinel_scenarios';
import { detectDuplicateMissedReimbursements } from '../services/detection/algorithms/duplicateMissedReimbursementAlgorithm';

async function runForensics() {
    const toTest = [
        'R2-OUT-OF-ORDER-04',
        'R4-DUPLICATE-01',
        'R7-CROSS-TENANT-01',
        'R9-ORPHAN-01',
        'R10-EPSILON-04'
    ];

    for (const id of toTest) {
        const scenario = SENTINEL_LAB_SCENARIOS.find(s => s.id === id);
        if (!scenario) continue;
        
        console.log(`\n=== Forensics for ${id} ===`);
        const results = await detectDuplicateMissedReimbursements(
            scenario.data.seller_id,
            scenario.data.sync_id,
            scenario.data
        );
        
        console.log(`Detected Anomalies: ${results.length}`);
        
        if (results.length > 0) {
            console.log(JSON.stringify(results.map(r => ({
                type: r.detection_type,
                state: r.evidence.recovery_cohort.cohort_state,
                evidence_class: r.evidence.recovery_cohort.evidence_class,
                residual_value: r.evidence.recovery_cohort.residual_value_delta,
                expected: r.evidence.recovery_cohort.expected_reimbursement_value,
                observed: r.evidence.recovery_cohort.observed_reimbursement_value,
                reasons: r.evidence.detection_reasons
            })), null, 2));
        } else {
            console.log("No result returned!");
        }
    }
}

runForensics().catch(console.error);
