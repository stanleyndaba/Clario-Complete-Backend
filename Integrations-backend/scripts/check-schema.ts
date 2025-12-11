/**
 * Check Detection Results Schema
 */

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSchema() {
    console.log('🔍 Checking detection_results schema...\n');

    // Get one row to see all columns
    const { data, error } = await supabase
        .from('detection_results')
        .select('*')
        .limit(1);

    if (error) {
        console.log('Error:', error.message);

        // Try to get table info directly
        const { data: info, error: infoError } = await supabase
            .rpc('get_table_info', { table_name: 'detection_results' });

        if (infoError) {
            console.log('RPC Error:', infoError.message);
        } else {
            console.log('Table info:', info);
        }
        return;
    }

    if (data && data.length > 0) {
        console.log('Columns in detection_results:');
        Object.keys(data[0]).forEach(key => {
            console.log(`  - ${key}: ${typeof data[0][key]} = ${JSON.stringify(data[0][key])?.substring(0, 50)}`);
        });
    } else {
        console.log('No data in detection_results - table might be empty');

        // Insert a minimal row to see what columns are required
        console.log('\nTrying minimal insert...');
        const { error: insertError } = await supabase
            .from('detection_results')
            .insert({
                user_id: '07b4f03d-352e-473f-a316-af97d9017d69'
            });

        if (insertError) {
            console.log('Insert error tells us required columns:', insertError.message);
        }
    }

    // Also check dispute_cases
    console.log('\n🔍 Checking dispute_cases schema...\n');
    const { data: disputes, error: disputeError } = await supabase
        .from('dispute_cases')
        .select('*')
        .limit(1);

    if (disputeError) {
        console.log('Error:', disputeError.message);
    } else if (disputes && disputes.length > 0) {
        console.log('Columns in dispute_cases:');
        Object.keys(disputes[0]).forEach(key => {
            console.log(`  - ${key}: ${typeof disputes[0][key]} = ${JSON.stringify(disputes[0][key])?.substring(0, 50)}`);
        });
    } else {
        console.log('No data in dispute_cases');
    }
}

checkSchema().catch(console.error);
