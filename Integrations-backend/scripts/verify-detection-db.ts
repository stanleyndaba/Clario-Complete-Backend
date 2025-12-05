
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDetections() {
    console.log('🔍 Checking detection_results table...');

    const { data, error, count } = await supabase
        .from('detection_results')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('❌ Error querying detection_results:', error.message);
        return;
    }

    console.log(`✅ Found ${count} total detection results`);

    if (data && data.length > 0) {
        console.log('Most recent detections:');
        data.forEach(d => {
            console.log(`- [${d.created_at}] ID: ${d.claim_id || d.external_id || d.id} | Type: ${d.anomaly_type} | Value: ${d.estimated_value} ${d.currency} | SyncID: ${d.sync_id}`);
        });
    } else {
        console.log('⚠️ No detection results found in the table.');
    }

    // Also check sync_progress to see what metadata says
    console.log('\n🔍 Checking sync_progress table...');
    const { data: syncData, error: syncError } = await supabase
        .from('sync_progress')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (syncError) {
        console.error('❌ Error querying sync_progress:', syncError.message);
        return;
    }

    if (syncData && syncData.length > 0) {
        console.log('Most recent syncs:');
        syncData.forEach(s => {
            console.log(`- [${s.created_at}] Status: ${s.status} | SyncID: ${s.sync_id}`);
            const metadata = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
            console.log(`  Claims Detected: ${metadata?.claimsDetected || metadata?.summary?.claimsDetected || 0}`);
            console.log(`  Summary:`, JSON.stringify(metadata?.summary || {}, null, 2));
        });
    }
}

checkDetections().catch(console.error);
