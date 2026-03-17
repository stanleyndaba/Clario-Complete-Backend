import 'dotenv/config';
import { runInboundDetection, storeInboundDetectionResults } from '../src/services/detection/core/detectors/inboundAlgorithms';
import { v4 as uuidv4 } from 'uuid';
import logger from '../src/utils/logger';

async function runAgent3Test() {
    const userId = '00000000-0000-0000-0000-000000000001';
    const syncId = uuidv4();

    console.log(`🚀 Unleashing Agent 3 (Inbound Inspector) for user: ${userId}`);
    console.log(`🔗 Sync ID: ${syncId}`);

    try {
        const results = await runInboundDetection(userId, syncId);

        console.log(`\n✅ Detection Complete! Found ${results.length} inbound anomalies.`);

        if (results.length > 0) {
            const totalValue = results.reduce((sum, r) => sum + r.estimated_value, 0);
            console.log(`💰 Total Estimated Recovery: $${totalValue.toFixed(2)}`);

            console.log('\n--- Breakdown by Anomaly Type ---');
            const breakdown: Record<string, number> = {};
            results.forEach(r => {
                breakdown[r.anomaly_type] = (breakdown[r.anomaly_type] || 0) + 1;
            });
            Object.entries(breakdown).forEach(([type, count]) => console.log(`${type}: ${count}`));

            console.log('\n--- Sample Detection (Proof) ---');
            const sample = results[0];
            console.log('Type:', sample.anomaly_type);
            console.log('Shipment ID:', sample.shipment_id);
            console.log('SKU:', sample.sku);
            console.log('Confidence:', sample.confidence_score);
            console.log('Evidence:', JSON.stringify(sample.evidence, null, 2));

            // Optional: Store results if you want them to persist in DB
            // await storeInboundDetectionResults(results);
            // console.log('\n💾 Results stored in database.');
        } else {
            console.log('\n⚠️ No inbound anomalies detected for this user in the current dataset.');
        }
    } catch (err: any) {
        console.error('❌ Error during Agent 3 detection:', err.message);
    }
}

runAgent3Test();
