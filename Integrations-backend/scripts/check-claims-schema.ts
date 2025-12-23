#!/usr/bin/env ts-node
/**
 * Check actual claims table schema in Supabase
 */
import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkClaimsSchema() {
    console.log('Checking claims table schema...\n');

    // Method 1: Try to get column information from pg_catalog
    const { data: columns, error: columnsError } = await supabase
        .rpc('get_table_columns', { table_name: 'claims' })
        .select('*');

    if (columns) {
        console.log('Columns from RPC:', columns);
    }

    // Method 2: Try inserting minimal data to see what's required
    const testInserts = [
        { user_id: 'test' },
        { user_id: 'test', claim_type: 'reimbursement' },
    ];

    for (const testData of testInserts) {
        const { data, error } = await supabase
            .from('claims')
            .insert(testData)
            .select();

        if (error) {
            console.log(`Insert test with ${Object.keys(testData).join(', ')}:`);
            console.log('  Error:', error.message);
            if (error.details) console.log('  Details:', error.details);
            if (error.hint) console.log('  Hint:', error.hint);
        } else {
            console.log('Insert SUCCESS with:', Object.keys(testData).join(', '));
            console.log('Row columns:', Object.keys(data?.[0] || {}));
            // Cleanup
            if (data?.[0]?.id) {
                await supabase.from('claims').delete().eq('id', data[0].id);
            }
            break;
        }
    }
}

checkClaimsSchema().catch(console.error);
