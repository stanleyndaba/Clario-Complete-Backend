
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSpecificUser() {
    // User ID from the Render logs provided by the user
    const targetUserId = 'stress-test-user-a5055d7b-f453-4f53-92c7-d2e22330f47f';

    console.log(`Checking for user from Render logs: ${targetUserId}`);
    console.log(`Supabase URL: ${supabaseUrl}`);
    console.log('='.repeat(60));

    // 1. Check evidence_sources
    const { data: sources, error: sourcesError } = await supabase
        .from('evidence_sources')
        .select('*')
        .or(`user_id.eq.${targetUserId},seller_id.eq.${targetUserId}`);

    if (sourcesError) {
        console.error('Error fetching sources:', sourcesError);
    } else {
        console.log(`\nFound ${sources?.length || 0} evidence sources for this user.`);
        if (sources?.length === 0) {
            console.log('❌ User NOT found in local DB evidence_sources table.');
            console.log('   This strongly suggests Render is using a DIFFERENT database.');
        } else {
            console.log('✅ User FOUND in local DB. We are looking at the same database.');
        }
    }
}

checkSpecificUser().catch(console.error);
