
import { detectAllFeeOvercharges, reconstructFeeCohorts } from '../services/detection/algorithms/feeAlgorithms';
import { generateAllScenarios } from './fee_phantom_scenarios';

const scenarios = generateAllScenarios();
const target = scenarios.find(s => s.id === 'F15-APPROVED-MAPPING-MATCH');

if (target) {
    console.log('--- DEBUGGING SCENARIO F15-APPROVED-MAPPING-MATCH ---');
    const data = {
        seller_id: 'fee-phantom-tester',
        sync_id: 'debug-sync',
        fee_events: target.fee_events,
        product_catalog: target.product_catalog
    };

    const cohorts = reconstructFeeCohorts(data as any);
    console.log('Cohorts found:', cohorts.length);
    cohorts.forEach(c => {
        console.log(`- ID: ${c.id}, Type: ${c.fee_type}, ID: ${c.primary_id}, Class: ${c.evidence_class}, State: ${c.state}, Net: ${c.net_value}, Events: ${c.events.length}`);
    });

    const results = detectAllFeeOvercharges('fee-phantom-tester', 'debug-sync', data as any);
    console.log('Results found:', results.length);
    results.forEach(r => {
        console.log(`- Anomaly: ${r.anomaly_type}, Value: ${r.estimated_value}`);
    });
}
