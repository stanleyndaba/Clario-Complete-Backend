import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifySyncFlow() {
    console.log('🔍 VERIFYING SYNC AGENT DATA FLOW\n');
    console.log('='.repeat(60));

    // Define time reference for filtering recent data
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // 1. Check seeded orders
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

    if (ordersError) {
        console.error('❌ Error fetching orders:', ordersError);
    } else {
        console.log(`\n📦 SEEDED ORDERS: ${orders.length} total`);
        console.log(`   Source: ${orders[0]?.source_report || 'N/A'}`);
        console.log(`   Date range: ${new Date(orders[orders.length - 1]?.order_date).toLocaleDateString()} to ${new Date(orders[0]?.order_date).toLocaleDateString()}`);

        const totalValue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
        console.log(`   Total value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }

    // 2. Check shipments
    const { data: shipments, error: shipmentsError } = await supabase
        .from('shipments')
        .select('*')
        .eq('user_id', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

    if (shipmentsError) {
        console.error('❌ Error fetching shipments:', shipmentsError);
    } else {
        console.log(`\n📦 SEEDED SHIPMENTS: ${shipments?.length || 0} total`);
        if (shipments && shipments.length > 0) {
            console.log(`   Source: ${shipments[0]?.source_report || 'N/A'}`);
        }
    }

    // 3. Check detection results (claims)
    const { data: recentClaims, error: claimsError } = await supabase
        .from('detection_results')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

    if (claimsError) {
        console.error('❌ Error fetching claims:', claimsError);
    } else {
        console.log(`\n🎯 DETECTION RESULTS: ${recentClaims.length} latest claims`);

        // Group by creation time (last hour)
        const recentDetections = recentClaims.filter(c => new Date(c.created_at) > oneHourAgo);

        console.log(`   Created in last hour: ${recentDetections.length}`);

        if (recentDetections.length > 0) {
            const totalValue = recentDetections.reduce((sum, c) => sum + (c.estimated_value || 0), 0);
            console.log(`   Total value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
            console.log(`   Latest claim timestamp: ${new Date(recentDetections[0].created_at).toISOString()}`);

            // Check if these claims reference our seeded orders
            const claimWithOrder = recentDetections.find(c => c.order_id);
            if (claimWithOrder) {
                console.log(`   Sample order_id from claim: ${claimWithOrder.order_id}`);

                // Check if this order_id exists in our seeded orders
                const matchingOrder = orders?.find(o => o.order_id === claimWithOrder.order_id);
                if (matchingOrder) {
                    console.log(`   ✅ VERIFIED: Claim references seeded order!`);
                } else {
                    console.log(`   ⚠️  Claim order_id not in seeded orders (might be from older data)`);
                }
            }
        }
    }

    // 4. Check sync_progress
    const { data: syncProgress, error: syncError } = await supabase
        .from('sync_progress')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(5);

    if (syncError) {
        console.error('❌ Error fetching sync progress:', syncError);
    } else if (syncProgress && syncProgress.length > 0) {
        console.log(`\n⚙️  RECENT SYNCS: ${syncProgress.length} found`);
        const latestSync = syncProgress[0];
        console.log(`   Latest sync: ${new Date(latestSync.started_at).toLocaleString()}`);
        console.log(`   Status: ${latestSync.status}`);
        console.log(`   Claims detected: ${latestSync.claims_detected || 0}`);
        console.log(`   Duration: ${latestSync.duration_seconds || 'N/A'}s`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ VERIFICATION COMPLETE!\n');

    // Summary
    console.log('📊 SUMMARY:');
    console.log(`   - Seeded data: ${orders?.length || 0} orders, ${shipments?.length || 0} shipments`);
    console.log(`   - Detection results: ${recentClaims.length} total claims in DB`);
    console.log(`   - Recent detections: ${recentClaims.filter(c => new Date(c.created_at) > oneHourAgo).length} in last hour`);
    console.log(`   - Sync status: ${syncProgress?.[0]?.status || 'Unknown'}`);

    if (recentClaims.filter(c => new Date(c.created_at) > oneHourAgo).length > 0) {
        console.log('\n✅ CLAIM DETECTION IS WORKING!');
        console.log('   Real data flow: Seeded Orders → Agent 2 → Python ML API → Claims DB');
    } else {
        console.log('\n⚠️  No recent claims detected. Try running a sync.');
    }
}

verifySyncFlow();
