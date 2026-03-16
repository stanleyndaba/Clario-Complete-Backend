
import { detectAllFeeOvercharges, reconstructFeeCohorts } from './src/services/detection/algorithms/feeAlgorithms';
import { detectFeeMisclassification } from './src/services/detection/algorithms/feeMisclassificationAlgorithm';
import { generateAllScenarios } from './src/scripts/fee_phantom_scenarios';

async function auditValue(scenarioId: string) {
    const scenarios = generateAllScenarios();
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) {
        console.error(`Scenario ${scenarioId} not found`);
        return;
    }

    console.log(`\n--- AUDIT: ${scenarioId} ---`);
    console.log(`Description: ${scenario.description}`);

    const feeSyncedData = {
        seller_id: 'fee-phantom-tester',
        sync_id: 'debug-sync',
        fee_events: scenario.fee_events,
        product_catalog: scenario.product_catalog
    };

    const feeMisclassSyncedData = {
        seller_id: 'fee-phantom-tester',
        sync_id: 'debug-sync',
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

    const auditorResults = detectAllFeeOvercharges('fee-phantom-tester', 'debug-sync', feeSyncedData as any);
    const misclassResults = await detectFeeMisclassification('fee-phantom-tester', 'debug-sync', feeMisclassSyncedData as any);
    
    console.log('\n[Auditor Results]');
    auditorResults.forEach((r: any) => {
        console.log(`Type: ${r.anomaly_type}, Value: ${r.estimated_value}, Summary: ${r.summary || r.evidence?.evidence_summary}`);
    });

    console.log('\n[Misclass Results]');
    misclassResults.forEach((r: any) => {
        console.log(`Type: ${r.misclass_type || r.anomaly_type}, Value: ${r.total_overcharge || r.estimated_value}, Summary: ${r.summary || r.evidence?.evidence_summary}`);
    });
}

async function run() {
    await auditValue('F3-OVERCHARGE-AGGREGATED');
    await auditValue('F6-SIZE-TIER-US-L-S');
    await auditValue('F10-RETURN-FEE-OVERCHARGE');
    await auditValue('F11-DUPLICATE-ORDER-FEE');
}

run().catch(console.error);
