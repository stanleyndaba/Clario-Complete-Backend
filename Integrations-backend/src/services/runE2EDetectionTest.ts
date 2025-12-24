/**
 * E2E Detection Test Script
 * 
 * Tests Agent 3's detection algorithms against real data
 */

// CRITICAL: Load env FIRST before any other imports
import * as dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin } from '../database/supabaseClient';
import {
    detectLostInventory,
    fetchInventoryLedger
} from './detection/algorithms/inventoryAlgorithms';
import {
    detectRefundWithoutReturn,
    fetchRefundEvents,
    fetchReturnEvents as fetchReturnsForRefund,
    fetchReimbursementEvents
} from './detection/algorithms/refundAlgorithms';
import {
    detectDamagedInventory,
    fetchDamagedEvents,
    fetchReimbursementsForDamage
} from './detection/algorithms/damagedAlgorithms';
import { detectInboundAnomalies, fetchInboundShipmentItems, fetchInboundReimbursements } from './detection/algorithms/inboundAlgorithms';
import { detectRemovalAnomalies, fetchRemovalOrders } from './detection/algorithms/removalAlgorithms';
import { detectFraudAnomalies, fetchReturnEvents, fetchRefundEventsForFraud } from './detection/algorithms/fraudAlgorithms';

async function runE2EDetectionTest(userId: string) {
    console.log('🧪 Starting E2E Detection Test\n');
    console.log('='.repeat(60));

    const syncId = `e2e-test-${Date.now()}`;
    const results: any = {
        dataCounts: {},
        detectionResults: {},
        totalAnomalies: 0,
        totalRecoveryValue: 0
    };

    // 1. Check data counts in all tables
    console.log('\n📊 STEP 1: Data Inventory\n');

    const tables = ['orders', 'returns', 'settlements', 'shipments'];
    for (const table of tables) {
        const { count, error } = await supabaseAdmin
            .from(table)
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        results.dataCounts[table] = count || 0;
        console.log(`   ${table}: ${count || 0} rows`);
    }

    // 2. Run Inventory Detection (Whale Hunter)
    console.log('\n🐋 STEP 2: Running Inventory Detection (Whale Hunter)...');
    try {
        const inventoryLedger = await fetchInventoryLedger(userId);
        console.log(`   Fetched ${inventoryLedger.length} inventory events`);

        if (inventoryLedger.length > 0) {
            const inventoryResults = detectLostInventory(userId, syncId, {
                seller_id: userId,
                sync_id: syncId,
                inventory_ledger: inventoryLedger
            });
            results.detectionResults.inventory = inventoryResults.length;
            results.totalAnomalies += inventoryResults.length;
            results.totalRecoveryValue += inventoryResults.reduce((sum, r) => sum + r.estimated_value, 0);
            console.log(`   ✅ Found ${inventoryResults.length} inventory anomalies`);
        } else {
            console.log('   ⚠️ No inventory data to analyze');
        }
    } catch (err: any) {
        console.log(`   ❌ Error: ${err.message}`);
    }

    // 3. Run Refund Detection (Refund Trap)
    console.log('\n🪤 STEP 3: Running Refund Detection (Refund Trap)...');
    try {
        const [refunds, returns, reimbursements] = await Promise.all([
            fetchRefundEvents(userId),
            fetchReturnsForRefund(userId),
            fetchReimbursementEvents(userId)
        ]);
        console.log(`   Fetched: ${refunds.length} refunds, ${returns.length} returns, ${reimbursements.length} reimbursements`);

        if (refunds.length > 0) {
            const refundResults = detectRefundWithoutReturn(userId, syncId, {
                seller_id: userId,
                sync_id: syncId,
                refund_events: refunds,
                return_events: returns,
                reimbursement_events: reimbursements
            });
            results.detectionResults.refund = refundResults.length;
            results.totalAnomalies += refundResults.length;
            results.totalRecoveryValue += refundResults.reduce((sum, r) => sum + r.estimated_value, 0);
            console.log(`   ✅ Found ${refundResults.length} refund anomalies`);
        } else {
            console.log('   ⚠️ No refund data to analyze');
        }
    } catch (err: any) {
        console.log(`   ❌ Error: ${err.message}`);
    }

    // 4. Run Damaged Detection (Broken Goods)
    console.log('\n💥 STEP 4: Running Damaged Detection (Broken Goods)...');
    try {
        const [damaged, damagedReimbs] = await Promise.all([
            fetchDamagedEvents(userId),
            fetchReimbursementsForDamage(userId)
        ]);
        console.log(`   Fetched: ${damaged.length} damaged events, ${damagedReimbs.length} reimbursements`);

        if (damaged.length > 0) {
            const damageResults = detectDamagedInventory(userId, syncId, {
                seller_id: userId,
                sync_id: syncId,
                inventory_ledger: damaged,
                reimbursement_events: damagedReimbs
            });
            results.detectionResults.damaged = damageResults.length;
            results.totalAnomalies += damageResults.length;
            results.totalRecoveryValue += damageResults.reduce((sum, r) => sum + r.estimated_value, 0);
            console.log(`   ✅ Found ${damageResults.length} damaged inventory anomalies`);
        } else {
            console.log('   ⚠️ No damaged data to analyze');
        }
    } catch (err: any) {
        console.log(`   ❌ Error: ${err.message}`);
    }

    // 5. Run Inbound Detection
    console.log('\n📦 STEP 5: Running Inbound Detection...');
    try {
        const [inboundItems, inboundReimbs] = await Promise.all([
            fetchInboundShipmentItems(userId),
            fetchInboundReimbursements(userId)
        ]);
        console.log(`   Fetched: ${inboundItems.length} shipments, ${inboundReimbs.length} reimbursements`);

        if (inboundItems.length > 0) {
            const inboundResults = detectInboundAnomalies(userId, syncId, {
                seller_id: userId,
                sync_id: syncId,
                inbound_shipment_items: inboundItems,
                reimbursement_events: inboundReimbs
            });
            results.detectionResults.inbound = inboundResults.length;
            results.totalAnomalies += inboundResults.length;
            results.totalRecoveryValue += inboundResults.reduce((sum, r) => sum + r.estimated_value, 0);
            console.log(`   ✅ Found ${inboundResults.length} inbound anomalies`);
        } else {
            console.log('   ⚠️ No inbound data to analyze');
        }
    } catch (err: any) {
        console.log(`   ❌ Error: ${err.message}`);
    }

    // 6. Run Fraud Detection
    console.log('\n🕵️ STEP 6: Running Fraud Detection...');
    try {
        const [fraudReturns, fraudRefunds] = await Promise.all([
            fetchReturnEvents(userId),
            fetchRefundEventsForFraud(userId)
        ]);
        console.log(`   Fetched: ${fraudReturns.length} returns, ${fraudRefunds.length} refunds`);

        if (fraudReturns.length > 0 || fraudRefunds.length > 0) {
            const fraudResults = detectFraudAnomalies(userId, syncId, {
                seller_id: userId,
                sync_id: syncId,
                return_events: fraudReturns,
                refund_events: fraudRefunds,
                reimbursement_events: []
            });
            results.detectionResults.fraud = fraudResults.length;
            results.totalAnomalies += fraudResults.length;
            results.totalRecoveryValue += fraudResults.reduce((sum, r) => sum + r.estimated_value, 0);
            console.log(`   ✅ Found ${fraudResults.length} fraud anomalies`);
        } else {
            console.log('   ⚠️ No fraud data to analyze');
        }
    } catch (err: any) {
        console.log(`   ❌ Error: ${err.message}`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📈 E2E TEST RESULTS\n');
    console.log('Data Counts:');
    Object.entries(results.dataCounts).forEach(([table, count]) => {
        console.log(`   ${table}: ${count}`);
    });

    console.log('\nDetection Results:');
    Object.entries(results.detectionResults).forEach(([type, count]) => {
        console.log(`   ${type}: ${count} anomalies`);
    });

    console.log(`\n🎯 TOTAL ANOMALIES: ${results.totalAnomalies}`);
    console.log(`💰 TOTAL RECOVERY VALUE: $${results.totalRecoveryValue.toFixed(2)}`);
    console.log('='.repeat(60));

    return results;
}

// Export for use
export { runE2EDetectionTest };

// Auto-detect a real user ID and run if called directly
async function main() {
    // Check for CLI argument FIRST - prioritize explicit user ID
    let testUserId = process.argv[2];

    if (testUserId) {
        console.log(`📍 Using provided user ID: ${testUserId}\n`);
    } else {
        // Auto-detect from orders table
        const { data: orderSample, error } = await supabaseAdmin
            .from('orders')
            .select('user_id')
            .limit(1);

        if (!error && orderSample && orderSample[0]?.user_id) {
            testUserId = orderSample[0].user_id;
            console.log(`📍 Auto-detected user ID: ${testUserId}\n`);
        } else {
            testUserId = 'test-user-123';
            console.log(`⚠️ Could not find real user ID, using: ${testUserId}\n`);
        }
    }

    try {
        const results = await runE2EDetectionTest(testUserId);
        console.log('\n✅ Test complete!');
        process.exit(0);
    } catch (err: any) {
        console.error('\n❌ Test failed:', err.message);
        process.exit(1);
    }
}

main();
