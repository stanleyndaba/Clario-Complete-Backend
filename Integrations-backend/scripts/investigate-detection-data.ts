/**
 * Investigate and Clean Detection Results
 * 
 * This script:
 * 1. Shows current detection_results data (anomaly types, values)
 * 2. Clears old detection_results for demo user
 * 3. Allows re-sync with fresh diverse data
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateAndClean() {
    console.log('\n=== DETECTION RESULTS INVESTIGATION ===\n');

    // 1. Get all users with detection results
    const { data: users, error: usersError } = await supabase
        .from('detection_results')
        .select('seller_id')
        .limit(100);

    if (usersError) {
        console.error('Error fetching users:', usersError);
        return;
    }

    const uniqueUsers = [...new Set(users?.map(u => u.seller_id) || [])];
    console.log(`Found ${uniqueUsers.length} users with detection results:\n`);

    for (const userId of uniqueUsers) {
        // Get detection results for this user
        const { data: results, error: resultsError } = await supabase
            .from('detection_results')
            .select('id, anomaly_type, estimated_value, created_at, sync_id')
            .eq('seller_id', userId)
            .order('created_at', { ascending: false });

        if (resultsError) {
            console.error(`Error fetching results for user ${userId}:`, resultsError);
            continue;
        }

        console.log(`\n--- User: ${userId.slice(0, 8)}... ---`);
        console.log(`Total results: ${results?.length || 0}`);

        // Count by anomaly type
        const typeCounts: Record<string, { count: number; totalValue: number }> = {};
        for (const r of results || []) {
            const type = r.anomaly_type || 'unknown';
            if (!typeCounts[type]) {
                typeCounts[type] = { count: 0, totalValue: 0 };
            }
            typeCounts[type].count++;
            typeCounts[type].totalValue += r.estimated_value || 0;
        }

        console.log('\nBreakdown by anomaly_type:');
        for (const [type, data] of Object.entries(typeCounts).sort((a, b) => b[1].count - a[1].count)) {
            console.log(`  ${type}: ${data.count} claims, $${data.totalValue.toFixed(2)}`);
        }

        // Show total value
        const totalValue = results?.reduce((sum, r) => sum + (r.estimated_value || 0), 0) || 0;
        console.log(`\nTotal recoverable value: $${totalValue.toFixed(2)}`);

        // Show sync IDs (to identify when data was created)
        const syncIds = [...new Set(results?.map(r => r.sync_id).filter(Boolean) || [])];
        console.log(`Sync IDs: ${syncIds.length} different syncs`);

        // Show date range
        if (results && results.length > 0) {
            const dates = results.map(r => new Date(r.created_at)).sort((a, b) => a.getTime() - b.getTime());
            console.log(`Date range: ${dates[0].toISOString().split('T')[0]} to ${dates[dates.length - 1].toISOString().split('T')[0]}`);
        }
    }

    // 2. Ask before clearing
    console.log('\n\n=== CLEANUP ===\n');
    console.log('Run with --clear flag to delete all detection_results');

    if (process.argv.includes('--clear')) {
        console.log('\nClearing all detection_results...');

        const { error: deleteError, count } = await supabase
            .from('detection_results')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (deleteError) {
            console.error('Error deleting:', deleteError);
        } else {
            console.log(`✅ Deleted ${count || 'all'} detection_results`);
            console.log('\nNow trigger a new sync from the UI to generate fresh diverse data.');
        }
    }
}

investigateAndClean().catch(console.error);
