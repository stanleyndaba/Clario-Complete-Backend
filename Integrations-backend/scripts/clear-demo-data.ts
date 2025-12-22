/**
 * Clear Demo User Data
 * Clears all recovery-related data for the demo user to start fresh
 * Tables to clear: recoveries, dispute_cases, claims, detection_results
 */

import * as dotenv from 'dotenv';
dotenv.config(); // Load .env before importing Supabase client

import { supabaseAdmin, supabase } from '../src/database/supabaseClient';
import logger from '../src/utils/logger';

async function clearDemoUserData() {
    const dbClient = supabaseAdmin || supabase;
    const userId = 'demo-user';

    console.log('🧹 Starting demo user data cleanup...\n');

    // 1. Clear recoveries table
    console.log('1. Clearing recoveries table...');
    const { error: recoveriesError, count: recoveriesCount } = await dbClient
        .from('recoveries')
        .delete()
        .eq('user_id', userId);

    if (recoveriesError) {
        console.log(`   ❌ Error: ${recoveriesError.message}`);
    } else {
        console.log(`   ✅ Deleted ${recoveriesCount || 0} rows from recoveries`);
    }

    // 2. Clear dispute_cases table
    console.log('2. Clearing dispute_cases table...');
    const { error: disputeError, count: disputeCount } = await dbClient
        .from('dispute_cases')
        .delete()
        .eq('seller_id', userId);

    if (disputeError) {
        console.log(`   ❌ Error: ${disputeError.message}`);
    } else {
        console.log(`   ✅ Deleted ${disputeCount || 0} rows from dispute_cases`);
    }

    // 3. Clear claims table
    console.log('3. Clearing claims table...');
    const { error: claimsError, count: claimsCount } = await dbClient
        .from('claims')
        .delete()
        .eq('user_id', userId);

    if (claimsError) {
        console.log(`   ❌ Error: ${claimsError.message}`);
    } else {
        console.log(`   ✅ Deleted ${claimsCount || 0} rows from claims`);
    }

    // 4. Clear detection_results table
    console.log('4. Clearing detection_results table...');
    const { error: detectionError, count: detectionCount } = await dbClient
        .from('detection_results')
        .delete()
        .eq('seller_id', userId);

    if (detectionError) {
        console.log(`   ❌ Error: ${detectionError.message}`);
    } else {
        console.log(`   ✅ Deleted ${detectionCount || 0} rows from detection_results`);
    }

    // 5. Clear synced data (orders, shipments, inventory, fees)
    console.log('5. Clearing synced data...');

    const tables = [
        { name: 'synced_orders', field: 'user_id' },
        { name: 'synced_shipments', field: 'user_id' },
        { name: 'synced_inventory', field: 'user_id' },
        { name: 'synced_fees', field: 'user_id' },
    ];

    for (const table of tables) {
        try {
            const { error, count } = await dbClient
                .from(table.name)
                .delete()
                .eq(table.field, userId);

            if (error) {
                console.log(`   ⚠️ ${table.name}: ${error.message}`);
            } else {
                console.log(`   ✅ ${table.name}: Deleted ${count || 0} rows`);
            }
        } catch (e: any) {
            console.log(`   ⚠️ ${table.name}: Table may not exist (${e.message})`);
        }
    }

    console.log('\n🎉 Demo user data cleanup complete!');
    console.log('The "Recovered Value" should now show $0.00 or blank.');
    console.log('Ready to start fresh with the E2E pipeline.\n');
}

// Run the cleanup
clearDemoUserData()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Cleanup failed:', err);
        process.exit(1);
    });
