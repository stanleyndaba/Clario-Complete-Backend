import { detectAllFeeOvercharges } from '../services/detection/algorithms/feeAlgorithms';
import { generateAllScenarios } from './fee_phantom_scenarios';

const MOCK_SELLER_ID = 'fee-phantom-tester';
const MOCK_SYNC_ID = 'bench-sync-999';

async function runForensics() {
    const scenarios = generateAllScenarios().filter(s => s.id.match(/^F(1[8-9]|2[0-5])/));
    const fps: any[] = [];

    for (const scenario of scenarios) {
        const feeSyncedData = {
            seller_id: MOCK_SELLER_ID,
            sync_id: MOCK_SYNC_ID,
            fee_events: scenario.fee_events,
            product_catalog: scenario.product_catalog as any
        };

        const auditorResults = detectAllFeeOvercharges(MOCK_SELLER_ID, MOCK_SYNC_ID, feeSyncedData as any);
        
        const hasExpected = scenario.expected_results.length > 0;
        const hasActual = auditorResults.length > 0;

        if (!hasExpected && hasActual) {
            // This is a False Positive!
            for (const r of auditorResults as any[]) {
                fps.push({
                    scenario_id: scenario.id,
                    family: scenario.family,
                    fee_type: r.evidence.fee_type || r.anomaly_type,
                    cohort_id: r.evidence.cohort_id || 'unknown',
                    evidence_class: r.evidence.evidence_class || 'unknown',
                    confidence_band: r.confidence_band || 'unknown',
                    valuation_owner: r.evidence.explanation?.valuation_owner || 'unknown',
                    expected_fee: r.evidence.explanation?.expected_fee ?? r.evidence.expected_amount ?? 'unknown',
                    observed_net_fee: r.evidence.explanation?.observed_fee ?? r.evidence.charged_amount ?? 'unknown',
                    emitted_value: r.estimated_value,
                    anomaly_reason: r.evidence.evidence_summary || 'unknown'
                });
            }
        }
    }
    
    console.log(JSON.stringify(fps, null, 2));
}

runForensics().catch(console.error);
