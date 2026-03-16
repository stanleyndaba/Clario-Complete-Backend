
import { detectAllFeeOvercharges, reconstructFeeCohorts } from './src/services/detection/algorithms/feeAlgorithms';
import { generateAllScenarios } from './src/scripts/fee_phantom_scenarios';

async function debug() {
    const scenarios = generateAllScenarios();
    const scenario = scenarios.find(s => s.id === 'F16-SKU-DETECT');
    if (!scenario) return;

    console.log('--- DEBUG F16-SKU-DETECT ---');
    const data = {
        seller_id: 'fee-phantom-tester',
        sync_id: 'debug-sync',
        fee_events: scenario.fee_events,
        product_catalog: scenario.product_catalog
    };

    const cohorts = reconstructFeeCohorts(data as any);
    console.log('Cohorts found:', cohorts.length);
    cohorts.forEach(c => {
        console.log(`Cohort ID: ${c.id}, FeeType: ${c.fee_type}, Evidence: ${c.evidence_class}, NetValue: ${c.net_value}`);
    });

    const results = detectAllFeeOvercharges('fee-phantom-tester', 'debug-sync', data as any);
    console.log('Results found:', results.length);
    results.forEach(r => {
        console.log(`Anomaly: ${r.anomaly_type}, Value: ${r.estimated_value}, Summary: ${r.evidence.evidence_summary}`);
    });
}

debug().catch(console.error);
