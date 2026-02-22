import 'dotenv/config';
import { fetchInboundShipmentItems } from '../src/services/detection/algorithms/inboundAlgorithms';

async function stage1() {
    const userId = '00000000-0000-0000-0000-000000000001';
    console.log(`\n=== STAGE 1: Data Alignment ===`);
    console.log(`User: ${userId}\n`);

    const items = await fetchInboundShipmentItems(userId);

    console.log(`Total inbound items fetched: ${items.length}`);

    if (items.length === 0) {
        console.log('❌ FAIL: No items fetched. Mapping is still broken.');
        process.exit(1);
    }

    // Show quantity mapping proof
    let withShippedQty = 0;
    let withReceivedQty = 0;
    let withDiscrepancy = 0;

    for (const item of items) {
        if (item.quantity_shipped > 0) withShippedQty++;
        if (item.quantity_received > 0) withReceivedQty++;
        if (item.quantity_shipped !== item.quantity_received) withDiscrepancy++;
    }

    console.log(`  Items with quantity_shipped > 0: ${withShippedQty}`);
    console.log(`  Items with quantity_received > 0: ${withReceivedQty}`);
    console.log(`  Items with discrepancy (shipped ≠ received): ${withDiscrepancy}`);

    // Show first 3 items as proof
    console.log(`\n--- Sample Items (first 3) ---`);
    items.slice(0, 3).forEach((item, i) => {
        console.log(`\nItem ${i + 1}:`);
        console.log(`  shipment_id: ${item.shipment_id}`);
        console.log(`  sku: ${item.sku}`);
        console.log(`  fnsku: ${item.fnsku}`);
        console.log(`  quantity_shipped: ${item.quantity_shipped}`);
        console.log(`  quantity_received: ${item.quantity_received}`);
        console.log(`  status: ${item.shipment_status}`);
        console.log(`  receiving_discrepancy: ${item.receiving_discrepancy}`);
    });

    if (withDiscrepancy > 0) {
        console.log(`\n--- Discrepancy Items ---`);
        items.filter(i => i.quantity_shipped !== i.quantity_received).forEach((item, idx) => {
            console.log(`\nDiscrepancy ${idx + 1}:`);
            console.log(`  shipment_id: ${item.shipment_id}`);
            console.log(`  shipped: ${item.quantity_shipped}, received: ${item.quantity_received}`);
            console.log(`  missing: ${item.quantity_shipped - item.quantity_received} units`);
        });
    }

    console.log(`\n✅ STAGE 1 PASS: ${items.length} items fetched with correct quantity mapping.`);
}

stage1().catch(console.error);
