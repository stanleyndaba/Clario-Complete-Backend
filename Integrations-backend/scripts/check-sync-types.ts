/**
 * Check what anomaly_types are in the last sync's detection results
 */
import { supabase } from '../src/database/supabaseClient';

async function checkLastSyncTypes() {
    console.log('🔍 Checking anomaly_types from last sync...\n');

    // Get most recent detection results
    const { data: detections, error } = await supabase
        .from('detection_results')
        .select('anomaly_type, estimated_value, confidence_score, created_at')
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    if (!detections || detections.length === 0) {
        console.log('⚠️ No detection results found.');
        return;
    }

    // Group by anomaly_type
    const byType: Record<string, { count: number; totalValue: number }> = {};
    for (const d of detections) {
        const type = d.anomaly_type || 'unknown';
        if (!byType[type]) {
            byType[type] = { count: 0, totalValue: 0 };
        }
        byType[type].count++;
        byType[type].totalValue += d.estimated_value || 0;
    }

    // Sort by count
    const sorted = Object.entries(byType).sort((a, b) => b[1].count - a[1].count);

    console.log(`📊 Detection Results (last 200):\n`);
    console.log('-'.repeat(60));
    for (const [type, stats] of sorted) {
        console.log(`   ${type}: ${stats.count} claims ($${stats.totalValue.toFixed(2)})`);
    }

    // Check for new types
    const newTypes64 = [
        'lost_warehouse', 'damaged_warehouse', 'lost_inbound', 'damaged_inbound',
        'carrier_claim', 'weight_fee_overcharge', 'storage_overcharge',
        'refund_commission_error', 'atoz_claim', 'tcs_cgst'
    ];

    const usedNewTypes = sorted.filter(([type]) => newTypes64.includes(type));

    console.log('\n' + '-'.repeat(60));
    console.log(`\n✅ Unique anomaly_types: ${sorted.length}`);
    console.log(`🆕 New 64 types in use: ${usedNewTypes.length}`);

    if (usedNewTypes.length > 0) {
        console.log(`   Found: ${usedNewTypes.map(([t]) => t).join(', ')}`);
    }

    // Total value
    const totalValue = sorted.reduce((sum, [, stats]) => sum + stats.totalValue, 0);
    console.log(`\n💰 Total recoverable: $${totalValue.toFixed(2)}`);
}

checkLastSyncTypes().catch(console.error);
