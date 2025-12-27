#!/usr/bin/env ts-node
/**
 * Cleanup Claims Script
 * 
 * Deletes all detection_results (claims) from the database.
 * Use this before running a fresh sync to test new detection logic.
 * 
 * Usage: npx ts-node scripts/cleanup-claims.ts
 */

import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanupClaims(): Promise<void> {
    console.log('🧹 Cleaning up claims/detection results...\n');

    try {
        // Get count before deletion
        const { count: beforeCount } = await supabase
            .from('detection_results')
            .select('id', { count: 'exact', head: true });

        console.log(`  📊 Found ${beforeCount || 0} detection results\n`);

        if (!beforeCount || beforeCount === 0) {
            console.log('  ✅ No claims to delete. Database is already clean.\n');
            return;
        }

        // Delete all detection_results
        const { error: detectionError } = await supabase
            .from('detection_results')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all (workaround for no-filter delete)

        if (detectionError) {
            console.error('  ❌ Error deleting detection_results:', detectionError.message);
        } else {
            console.log(`  ✓ Deleted ${beforeCount} detection results`);
        }

        // Also clear detection_queue
        const { error: queueError } = await supabase
            .from('detection_queue')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000');

        if (queueError && !queueError.message.includes('does not exist')) {
            console.log(`  ⚠️ detection_queue: ${queueError.message}`);
        } else {
            console.log('  ✓ Cleared detection_queue');
        }

        console.log('\n✅ Cleanup complete!');
        console.log('   Next: Run a sync to generate new claims with proper ASIN/SKU data');
        console.log('   Command: Click "Scan" in dashboard or call POST /api/sync/start\n');

    } catch (error: any) {
        console.error('\n❌ Error during cleanup:', error.message);
        process.exit(1);
    }
}

cleanupClaims();
