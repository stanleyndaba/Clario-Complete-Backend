/**
 * Check existing claims in database and their types
 */
import { supabase } from '../src/database/supabaseClient';

async function checkDetections() {
    console.log('🔍 Checking detection_results table...\n');

    // Get count of all detections
    const { count: totalCount, error: countError } = await supabase
        .from('detection_results')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        console.error('Error:', countError.message);
        return;
    }

    console.log(`📊 Total detections in database: ${totalCount || 0}\n`);

    // Get breakdown by anomaly_type
    const { data: detections, error } = await supabase
        .from('detection_results')
        .select('anomaly_type, estimated_value, confidence_score, status')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('Error fetching detections:', error.message);
        return;
    }

    if (!detections || detections.length === 0) {
        console.log('⚠️ No detections found in database.');
        console.log('   This means either:');
        console.log('   1. No sync has been run yet');
        console.log('   2. The ML model needs training data');
        console.log('   3. Mock data generator needs to create events with new types');
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

    console.log('📋 Detections by anomaly_type:');
    console.log('-'.repeat(60));

    const sortedTypes = Object.entries(byType).sort((a, b) => b[1].count - a[1].count);
    for (const [type, stats] of sortedTypes) {
        console.log(`   ${type}: ${stats.count} claims ($${stats.totalValue.toFixed(2)})`);
    }

    // Check if using new types
    const newTypes = [
        'lost_warehouse', 'damaged_warehouse', 'carrier_claim',
        'weight_fee_overcharge', 'storage_overcharge', 'refund_commission_error',
        'atoz_claim', 'tcs_cgst'
    ];

    const usedNewTypes = sortedTypes.filter(([type]) => newTypes.includes(type));

    console.log('\n' + '-'.repeat(60));
    console.log(`\n🆕 New types in use: ${usedNewTypes.length}/${newTypes.length}`);

    if (usedNewTypes.length === 0) {
        console.log('\n⚠️ No new types detected yet.');
        console.log('   The ML model may need:');
        console.log('   1. Training data with the new categories');
        console.log('   2. Or mock data generator update to produce new event types');
    }
}

checkDetections().catch(console.error);
