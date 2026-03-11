/**
 * Run migration 065: Create inventory_ledger_events table
 * Uses Supabase REST API (supabaseAdmin) since direct PG connection is unavailable.
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import logger from '../src/utils/logger';

async function runMigration065() {
    logger.info('🚀 Running migration 065: inventory_ledger_events table...');

    // Test if the table already exists by trying to select from it
    const { error: testError } = await supabaseAdmin
        .from('inventory_ledger_events')
        .select('id')
        .limit(1);

    if (!testError) {
        logger.info('✅ Table inventory_ledger_events already exists, skipping creation.');
        return;
    }

    // Table doesn't exist - we need to create it via Supabase SQL Editor
    // Since supabaseAdmin doesn't support raw SQL execution, print instructions
    logger.info('⚠️  Table inventory_ledger_events does not exist yet.');
    logger.info('');
    logger.info('📋 Please run the following SQL in Supabase SQL Editor:');
    logger.info('   https://supabase.com/dashboard/project/uuuqpujtnubusmigbkvw/sql/new');
    logger.info('');

    const { readFileSync } = require('fs');
    const { join } = require('path');
    const sql = readFileSync(join(__dirname, '..', 'migrations', '065_create_inventory_ledger_events.sql'), 'utf-8');
    console.log('--- SQL START ---');
    console.log(sql);
    console.log('--- SQL END ---');
    logger.info('');
    logger.info('💡 After running the SQL, re-run this script to verify.');
}

runMigration065().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
});
