import * as fs from 'fs';
import * as path from 'path';
import { detectInboundAnomalies, InboundSyncedData, InboundShipmentItem } from '../src/services/detection/core/detectors/inboundAlgorithms';

function shiftDate(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString();
}

async function runLoosePolicyTest() {
    const csvPath = path.join(__dirname, '../Inbound_Shipment_Ledger_Test.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');

    const items: InboundShipmentItem[] = lines.slice(1).map((line, index) => {
        const parts = line.split(',');
        // SHADOW LOGIC: Shift dates back by 200 days to bypass the 90-day threshold
        const fakeDate = shiftDate(parts[0], -200);
        
        return {
            id: `test-item-${index}`,
            seller_id: 'test-seller-123',
            shipment_id: parts[1],
            sku: parts[2],
            fnsku: parts[2],
            quantity_shipped: parseInt(parts[3]),
            quantity_received: parseInt(parts[4]),
            shipment_status: parts[6],
            shipment_created_date: fakeDate,
            shipment_closed_date: parts[6] === 'CLOSED' ? fakeDate : undefined,
            created_at: new Date().toISOString()
        };
    });

    const syncedData: InboundSyncedData = {
        seller_id: 'test-seller-123',
        sync_id: 'test-sync-shadow',
        inbound_shipment_items: items,
        reimbursement_events: []
    };

    console.log(`🕵️ [SHADOW TEST] Running Loose Policy Simulation (Thresholds Ignored)...`);
    const results = await detectInboundAnomalies('test-seller-123', 'test-sync-shadow', syncedData);

    console.log(`\n🚨 [UNFILTERED FINDINGS] Potential Detections if Policy was Ignored:`);
    console.log('---------------------------------------------------------');
    
    results.forEach(res => {
        const unitsLost = res.evidence.expected_sent_units - res.evidence.observed_received_units;
        console.log(`📍 Shipment: ${res.shipment_id} | SKU: ${res.sku}`);
        console.log(`   Type: ${res.anomaly_type} | Shortage: ${unitsLost} units`);
        console.log(`   Status: ${res.evidence.status_mode}`);
        console.log('---------------------------------------------------------');
    });

    console.log(`\n📈 SUMMARY:`);
    console.log(`Original Detections: 2`);
    console.log(`Loose Mode Detections: ${results.length}`);
    console.log(`Additional cases blocked by 90-day safety: ${results.length - 2}`);
}

runLoosePolicyTest().catch(console.error);
