/**
 * End-to-end test: CSV → Ingestion → inventory_ledger_events → Detection → detection_results with tenant_id
 * 
 * This script exercises the full pipeline that feeds the preview drawer.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import { supabaseAdmin } from '../src/database/supabaseClient';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_SYNC_ID = 'e2e-test-' + Date.now();

async function runE2ETest() {
    console.log('🚀 === END-TO-END PIPELINE TEST ===\n');

    // ======== STEP 1: Parse CSV ========
    const csvPath = path.resolve(__dirname, '../juiced-demo.csv');
    console.log('📄 STEP 1: Reading CSV file...');
    if (!fs.existsSync(csvPath)) {
        console.error('❌ File not found:', csvPath);
        return;
    }

    const content = fs.readFileSync(csvPath, 'utf-8');
    const records = csvParse(content, { columns: true, skip_empty_lines: true, trim: true });
    console.log(`   ✅ Parsed ${records.length} records from CSV`);

    // Show column names
    if (records.length > 0) {
        console.log(`   📋 Columns: ${Object.keys(records[0]).join(', ')}`);
    }

    // ======== STEP 2: Check inventory_ledger_events table ========
    console.log('\n📊 STEP 2: Checking inventory_ledger_events table...');
    const { data: ledgerBefore, error: ledgerErr } = await supabaseAdmin
        .from('inventory_ledger_events')
        .select('id', { count: 'exact', head: true });

    if (ledgerErr) {
        console.error('   ❌ Table query failed:', ledgerErr.message);
        console.error('   💡 Make sure the migration 065 has been run in Supabase SQL Editor');
        return;
    }
    console.log(`   ✅ Table exists! Current row count: checking...`);

    const { count: currentCount } = await supabaseAdmin
        .from('inventory_ledger_events')
        .select('id', { count: 'exact', head: true });
    console.log(`   📊 Current rows in inventory_ledger_events: ${currentCount || 0}`);

    // ======== STEP 3: Simulate ingestion of CSV data ========
    console.log('\n📥 STEP 3: Ingesting CSV data into inventory_ledger_events...');

    const ledgerRecords = records.map((r: any, i: number) => ({
        user_id: TEST_USER_ID,
        tenant_id: TEST_USER_ID,
        sync_id: TEST_SYNC_ID,
        event_type: r['Event Type'] || r['event_type'] || 'Unknown',
        event_date: r['Date'] ? new Date(r['Date']).toISOString() : new Date().toISOString(),
        fnsku: r['FNSKU'] || r['fnsku'] || 'UNKNOWN',
        sku: r['MSKU'] || r['SKU'] || r['sku'] || null,
        asin: r['ASIN'] || r['asin'] || null,
        product_name: r['Title'] || r['Product Name'] || null,
        quantity: parseInt(r['Quantity'] || r['quantity'] || '0') || 0,
        quantity_direction: (parseInt(r['Quantity'] || '0') || 0) >= 0 ? 'in' : 'out',
        disposition: r['Disposition'] || r['disposition'] || null,
        reason: r['Reason'] || r['reason'] || null,
        fulfillment_center: r['Fulfillment Center'] || r['FC'] || null,
        reference_id: r['Reference ID'] || r['reference_id'] || null,
        country: r['Country'] || 'US',
        raw_payload: r,
        source: 'csv_upload'
    }));

    // Clean up any previous test data
    await supabaseAdmin
        .from('inventory_ledger_events')
        .delete()
        .eq('sync_id', TEST_SYNC_ID);

    const { error: insertErr } = await supabaseAdmin
        .from('inventory_ledger_events')
        .insert(ledgerRecords);

    if (insertErr) {
        console.error('   ❌ Ingestion failed:', insertErr.message);
        console.error('   Details:', JSON.stringify(insertErr, null, 2));
        return;
    }
    console.log(`   ✅ Ingested ${ledgerRecords.length} records into inventory_ledger_events`);

    // ======== STEP 4: Verify data in table ========
    console.log('\n🔍 STEP 4: Verifying ingested data...');
    const { data: verifyData, error: verifyErr } = await supabaseAdmin
        .from('inventory_ledger_events')
        .select('event_type, quantity, fnsku, disposition')
        .eq('sync_id', TEST_SYNC_ID)
        .limit(10);

    if (verifyErr) {
        console.error('   ❌ Verification failed:', verifyErr.message);
    } else {
        console.log(`   ✅ Sample records from DB:`);
        (verifyData || []).slice(0, 5).forEach((r: any) => {
            console.log(`      • ${r.event_type} | FNSKU: ${r.fnsku} | Qty: ${r.quantity} | Disp: ${r.disposition}`);
        });
    }

    // ======== STEP 5: Run detection algorithms ========
    console.log('\n🐋 STEP 5: Running Whale Hunter (inventory detection)...');

    try {
        const { detectLostInventory, fetchInventoryLedger, storeDetectionResults } = await import('../src/services/detection/algorithms/inventoryAlgorithms');

        const ledgerData = await fetchInventoryLedger(TEST_USER_ID);
        console.log(`   📊 fetchInventoryLedger returned ${ledgerData.length} events`);

        if (ledgerData.length === 0) {
            console.log('   ⚠️ No ledger data fetched — detection cannot run');
        } else {
            const detections = detectLostInventory(TEST_USER_ID, TEST_SYNC_ID, {
                seller_id: TEST_USER_ID,
                sync_id: TEST_SYNC_ID,
                inventory_ledger: ledgerData
            });
            console.log(`   🎯 Detected ${detections.length} anomalies`);

            if (detections.length > 0) {
                console.log('\n   📋 Detection Results:');
                detections.forEach((d: any, i: number) => {
                    console.log(`      ${i + 1}. [${d.severity.toUpperCase()}] ${d.anomaly_type} — $${d.estimated_value.toFixed(2)} | Confidence: ${(d.confidence_score * 100).toFixed(0)}%`);
                    if (d.evidence?.summary) {
                        console.log(`         ${d.evidence.summary.substring(0, 120)}...`);
                    }
                });

                // Store them
                console.log('\n💾 STEP 6: Storing detection results with tenant_id...');
                await storeDetectionResults(detections);
                console.log('   ✅ Detection results stored');

                // Verify tenant_id
                const { data: storedResults, error: storeErr } = await supabaseAdmin
                    .from('detection_results')
                    .select('anomaly_type, severity, estimated_value, tenant_id, status')
                    .eq('sync_id', TEST_SYNC_ID)
                    .limit(10);

                if (storeErr) {
                    console.error('   ❌ Could not verify stored results:', storeErr.message);
                } else {
                    console.log(`\n   🏷️ Stored ${(storedResults || []).length} results in detection_results:`);
                    (storedResults || []).forEach((r: any) => {
                        console.log(`      • ${r.anomaly_type} | ${r.severity} | $${r.estimated_value} | tenant_id: ${r.tenant_id ? '✅ ' + r.tenant_id.substring(0, 8) + '...' : '❌ MISSING'} | status: ${r.status}`);
                    });

                    const hasTenantId = (storedResults || []).every((r: any) => !!r.tenant_id);
                    if (hasTenantId) {
                        console.log('\n   ✅ ALL results have tenant_id — Frontend will see these!');
                    } else {
                        console.log('\n   ❌ Some results are MISSING tenant_id — Frontend WILL NOT show these!');
                    }
                }
            }
        }
    } catch (err: any) {
        console.error('   ❌ Detection error:', err.message);
        if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    }

    // ======== CLEANUP ========
    console.log('\n🧹 Cleaning up test data...');
    await supabaseAdmin.from('inventory_ledger_events').delete().eq('sync_id', TEST_SYNC_ID);
    await supabaseAdmin.from('detection_results').delete().eq('sync_id', TEST_SYNC_ID);
    console.log('   ✅ Test data cleaned up');

    console.log('\n🏁 === TEST COMPLETE ===');
}

runE2ETest().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
