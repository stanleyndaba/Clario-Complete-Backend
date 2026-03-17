import * as fs from 'fs';
import * as path from 'path';
import { detectInboundAnomalies, InboundSyncedData, InboundShipmentItem } from '../src/services/detection/core/detectors/inboundAlgorithms';
import logger from '../src/utils/logger';

async function runCsvTest() {
    const csvPath = path.join(__dirname, '../Inbound_Shipment_Ledger_Test.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    const headers = lines[0].split(',');

    const items: InboundShipmentItem[] = lines.slice(1).map((line, index) => {
        const parts = line.split(',');
        return {
            id: `test-item-${index}`,
            seller_id: 'test-seller-123',
            shipment_id: parts[1],
            sku: parts[2], // Using FNSKU as SKU for test
            fnsku: parts[2],
            quantity_shipped: parseInt(parts[3]),
            quantity_received: parseInt(parts[4]),
            shipment_status: parts[6],
            shipment_created_date: parts[0],
            created_at: new Date().toISOString()
        };
    });

    const syncedData: InboundSyncedData = {
        seller_id: 'test-seller-123',
        sync_id: 'test-sync-999',
        inbound_shipment_items: items,
        reimbursement_events: [] // No prior reimbursements for this test
    };

    console.log(`📊 [TEST] Processing ${items.length} shipment items from CSV...`);
    
    // Each detector in inboundAlgorithms handles specific logic. 
    // detectInboundAnomalies is the main entry point that runs all of them.
    const results = await detectInboundAnomalies('test-seller-123', 'test-sync-999', syncedData);

    console.log(`\n🔍 [DETECTION RESULTS] Found ${results.length} anomalies:`);
    console.log('---------------------------------------------------------');
    
    results.forEach(res => {
        const unitsLost = res.evidence.expected_sent_units - res.evidence.observed_received_units;
        console.log(`📍 Shipment: ${res.shipment_id} | SKU: ${res.sku}`);
        console.log(`   Type: ${res.anomaly_type} | Severity: ${res.severity}`);
        console.log(`   Shortage: ${unitsLost} units | Value: $${res.estimated_value.toFixed(2)}`);
        console.log(`   Summary: ${res.evidence.summary}`);
        console.log('---------------------------------------------------------');
    });

    if (results.length === 0) {
        console.log('✅ No anomalies detected. (Everything matches)');
    } else {
        console.log(`✅ TEST COMPLETE: Successfully detected ${results.length} shortages.`);
    }
}

runCsvTest().catch(console.error);
