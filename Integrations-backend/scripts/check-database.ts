/**
 * Database Check Script
 * Verifies Supabase connection and counts rows in key tables
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

console.log('🔍 DATABASE CHECK');
console.log('================');
console.log('SUPABASE_URL:', SUPABASE_URL ? `${SUPABASE_URL.substring(0, 30)}...` : '❌ NOT SET');
console.log('SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? '✅ SET' : '❌ NOT SET');
console.log('USE_MOCK_SPAPI:', process.env.USE_MOCK_SPAPI || 'not set');
console.log('');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing Supabase credentials. Cannot connect.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TABLES_TO_CHECK = [
    'orders',
    'inventory',
    'claims',
    'detection_results',
    'documents',
    'dispute_cases',
    'recoveries',
    'financial_events',
    'sync_status',
    'agent_events'
];

async function checkTables() {
    console.log('📊 TABLE ROW COUNTS:');
    console.log('--------------------');

    for (const table of TABLES_TO_CHECK) {
        try {
            const { count, error } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });

            if (error) {
                console.log(`  ${table}: ❌ Error - ${error.message}`);
            } else {
                const emoji = count && count > 0 ? '✅' : '⚪';
                console.log(`  ${table}: ${emoji} ${count ?? 0} rows`);
            }
        } catch (e: any) {
            console.log(`  ${table}: ❌ Exception - ${e.message}`);
        }
    }

    console.log('');
    console.log('================');
    console.log('If all tables show 0 rows, your syncs are not persisting to Supabase.');
    console.log('Check that USE_MOCK_SPAPI=true is set in .env');
}

checkTables().catch(console.error);
