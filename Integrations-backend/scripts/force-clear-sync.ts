#!/usr/bin/env ts-node
/**
 * Force Clear Sync Lock
 * 
 * Clears any stuck sync jobs from the database.
 * Use when you get "Sync already in progress" error but no sync is running.
 * 
 * Usage: npx ts-node scripts/force-clear-sync.ts
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

async function forceClearSync(): Promise<void> {
    console.log('🔓 Force clearing stale sync locks...\n');

    try {
        // Find all running syncs
        const { data: runningSyncs, error: findError } = await supabase
            .from('sync_progress')
            .select('sync_id, user_id, status, current_step, created_at, updated_at')
            .eq('status', 'running');

        if (findError) {
            console.error('❌ Error finding syncs:', findError.message);
            return;
        }

        if (!runningSyncs || runningSyncs.length === 0) {
            console.log('  ✅ No stuck syncs found. All clear!\n');
            return;
        }

        console.log(`  📊 Found ${runningSyncs.length} sync(s) in 'running' status:\n`);

        for (const sync of runningSyncs) {
            const createdAt = new Date(sync.created_at);
            const updatedAt = new Date(sync.updated_at);
            const ageMinutes = Math.round((Date.now() - updatedAt.getTime()) / 60000);

            console.log(`  - Sync ID: ${sync.sync_id}`);
            console.log(`    User: ${sync.user_id}`);
            console.log(`    Status: ${sync.status}`);
            console.log(`    Step: ${sync.current_step}`);
            console.log(`    Started: ${createdAt.toISOString()}`);
            console.log(`    Last Update: ${updatedAt.toISOString()} (${ageMinutes} min ago)`);
            console.log('');
        }

        // Force update all running syncs to 'failed'
        const { error: updateError } = await supabase
            .from('sync_progress')
            .update({
                status: 'failed',
                current_step: 'Force-cleared by admin script',
                error_code: 'ADMIN_CLEARED',
                updated_at: new Date().toISOString()
            })
            .eq('status', 'running');

        if (updateError) {
            console.error('❌ Error clearing syncs:', updateError.message);
            return;
        }

        console.log(`  ✓ Cleared ${runningSyncs.length} stuck sync(s)`);
        console.log('\n✅ Sync locks cleared! You can now start a new sync.\n');

    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

forceClearSync();
