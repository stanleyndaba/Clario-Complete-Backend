#!/usr/bin/env ts-node
import { config } from 'dotenv';
config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
    const { data, error } = await supabase
        .from('detection_results')
        .select('id, claim_number, anomaly_type')
        .limit(5);

    console.log('\n=== DETECTION RESULTS claim_number check ===\n');
    if (error) {
        console.log('Error:', error.message);
    } else {
        data?.forEach((row, i) => {
            console.log(`[${i + 1}] id: ${row.id?.slice(0, 8)}...`);
            console.log(`    claim_number: ${row.claim_number || 'NULL'}`);
            console.log(`    anomaly_type: ${row.anomaly_type}`);
        });
        console.log(`\nTotal shown: ${data?.length || 0}`);
    }
}
check().catch(console.error);
