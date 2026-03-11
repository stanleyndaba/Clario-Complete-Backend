/**
 * Debug script: trace exactly what happens with FNSKU X00LOST1
 * which should show a transfer discrepancy (-400 out, +186 in = 214 lost)
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import { supabaseAdmin } from '../src/database/supabaseClient';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_SYNC_ID = 'debug-test-' + Date.now();

async function debugDetection() {
    console.log('🔬 === DEBUG TRACE ===\n');

    // Parse CSV
    const csvPath = path.resolve(__dirname, '../juiced-demo.csv');
    const content = fs.readFileSync(csvPath, 'utf-8');
    const records = csvParse(content, { columns: true, skip_empty_lines: true, trim: true });

    // Insert test data
    const ledgerRecords = (records as any[]).map((r: any) => ({
        user_id: TEST_USER_ID,
        tenant_id: TEST_USER_ID,
        sync_id: TEST_SYNC_ID,
        event_type: r['Event Type'] || 'Unknown',
        event_date: r['Date'] ? new Date(r['Date']).toISOString() : new Date().toISOString(),
        fnsku: r['FNSKU'] || 'UNKNOWN',
        sku: r['MSKU'] || null,
        asin: r['ASIN'] || null,
        product_name: r['Title'] || null,
        quantity: parseInt(r['Quantity'] || '0') || 0,
        quantity_direction: (parseInt(r['Quantity'] || '0') || 0) >= 0 ? 'in' : 'out',
        disposition: r['Disposition'] || null,
        reason: r['Reason'] || null,
        fulfillment_center: r['Fulfillment Center'] || null,
        reference_id: r['Reference ID'] || null,
        country: r['Country'] || 'US',
        raw_payload: r,
        source: 'csv_upload'
    }));

    await supabaseAdmin.from('inventory_ledger_events').delete().eq('sync_id', TEST_SYNC_ID);
    await supabaseAdmin.from('inventory_ledger_events').insert(ledgerRecords);
    console.log(`✅ Ingested ${ledgerRecords.length} records\n`);

    // Fetch the ledger
    const { fetchInventoryLedger } = await import('../src/services/detection/algorithms/inventoryAlgorithms');
    const ledgerData = await fetchInventoryLedger(TEST_USER_ID);
    console.log(`📊 fetchInventoryLedger returned ${ledgerData.length} events\n`);

    // Inspect X00LOST1 events
    console.log('🔍 X00LOST1 events from fetchInventoryLedger:');
    const lost1Events = ledgerData.filter((e: any) => e.fnsku === 'X00LOST1');
    console.log(`   Found ${lost1Events.length} events for X00LOST1`);
    lost1Events.forEach((e: any, i: number) => {
        console.log(`   [${i}] event_type="${e.event_type}" quantity=${e.quantity} quantity_direction="${e.quantity_direction}" fc="${e.fulfillment_center_id}"`);
        console.log(`        All keys: ${Object.keys(e).join(', ')}`);
    });

    // Inspect X00DAMAGED5 events
    console.log('\n🔍 X00DAMAGED5 events:');
    const dmg5Events = ledgerData.filter((e: any) => e.fnsku === 'X00DAMAGED5');
    dmg5Events.forEach((e: any, i: number) => {
        console.log(`   [${i}] event_type="${e.event_type}" quantity=${e.quantity} direction="${e.quantity_direction}"`);
    });

    // Inspect X00INBOUND9 events
    console.log('\n🔍 X00INBOUND9 events:');
    const inb9Events = ledgerData.filter((e: any) => e.fnsku === 'X00INBOUND9');
    inb9Events.forEach((e: any, i: number) => {
        console.log(`   [${i}] event_type="${e.event_type}" quantity=${e.quantity} direction="${e.quantity_direction}"`);
    });

    // Manual trace of normalization for X00LOST1
    console.log('\n🧮 Manual normalization trace for X00LOST1:');
    let transferOut = 0, transferIn = 0;
    for (const e of lost1Events) {
        const rt = (e.event_type || '').trim();
        let nt = rt;
        if (/^CustomerReturn/i.test(rt)) nt = 'Return';
        else if (rt.endsWith('s') && rt.length > 2) nt = rt.slice(0, -1);
        
        console.log(`   event_type="${rt}" → normalized="${nt}" qty=${e.quantity}`);
        if (nt === 'Transfer') {
            if (e.quantity < 0) transferOut += Math.abs(e.quantity);
            else transferIn += Math.abs(e.quantity);
        }
    }
    console.log(`   Transfer OUT: ${transferOut}, Transfer IN: ${transferIn}`);
    console.log(`   Discrepancy: ${transferOut - transferIn} units`);
    console.log(`   Should trigger? ${transferOut > 0 && transferIn > 0 && transferOut > transferIn ? 'YES ✅' : 'NO ❌'}`);

    // Cleanup
    await supabaseAdmin.from('inventory_ledger_events').delete().eq('sync_id', TEST_SYNC_ID);
    console.log('\n✅ Cleanup done');
}

debugDetection().catch(console.error);
