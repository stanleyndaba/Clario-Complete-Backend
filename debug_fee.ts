
import { detectAllFeeOvercharges, reconstructFeeCohorts } from './Integrations-backend/src/services/detection/algorithms/feeAlgorithms';
import { generateAllScenarios } from './Integrations-backend/src/scripts/fee_phantom_scenarios';

const scenarios = generateAllScenarios();
const target = scenarios.find(s => s.id === 'F15-STRICT-REF-MATCH');

if (target) {
    console.log('--- DEBUGGING SCENARIO F15-STRICT-REF-MATCH ---');
    const data = {
        seller_id: 'fee-phantom-tester',
        sync_id: 'debug-sync',
        fee_events: target.fee_events,
        product_catalog: target.product_catalog
    };

    const cohorts = reconstructFeeCohorts(data as any);
    console.log('Cohorts found:', cohorts.length);
    cohorts.forEach(c => {
        console.log(`- ID: ${c.id}, Type: ${c.fee_type}, Context: ${c.secondary_context}, State: ${c.state}, Net: ${c.net_value}, Evidence: ${c.evidence_class}`);
    });

    const results = detectAllFeeOvercharges('fee-phantom-tester', 'debug-sync', data as any);
    console.log('Results found:', results.length);
    results.forEach(r => {
        console.log(`- Anomaly: ${r.anomaly_type}, Value: ${r.estimated_value}, SKU: ${r.sku}`);
    });
} else {
    console.log('Scenario not found');
}
