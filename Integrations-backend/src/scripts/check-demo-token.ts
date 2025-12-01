
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';
import { convertUserIdToUuid } from '../database/supabaseClient';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkDemoUserToken() {
    const userId = 'demo-user';
    const dbUserId = convertUserIdToUuid(userId);

    console.log(`Checking Gmail token for userId: "${userId}"`);
    console.log(`Converted to UUID: "${dbUserId}"`);
    console.log('='.repeat(60));

    // Check tokens table
    const { data: tokens, error: tokensError } = await supabase
        .from('tokens')
        .select('user_id, provider, expires_at, created_at')
        .eq('provider', 'gmail');

    if (tokensError) {
        console.error('Error fetching tokens:', tokensError);
    } else {
        console.log(`\nFound ${tokens?.length || 0} Gmail tokens in database:`);
        tokens?.forEach(t => {
            const isMatch = t.user_id === dbUserId;
            console.log(`  ${isMatch ? '✅' : '❌'} User ID: ${t.user_id} ${isMatch ? '(MATCH!)' : ''}`);
            console.log(`     Created: ${t.created_at}`);
            console.log(`     Expires: ${t.expires_at}`);
        });
    }

    // Check evidence_sources table
    const { data: sources, error: sourcesError } = await supabase
        .from('evidence_sources')
        .select('user_id, provider, account_email, status, created_at')
        .eq('provider', 'gmail');

    if (sourcesError) {
        console.error('\nError fetching evidence sources:', sourcesError);
    } else {
        console.log(`\n\nFound ${sources?.length || 0} Gmail evidence sources:`);
        sources?.forEach(s => {
            const isMatch = s.user_id === dbUserId;
            console.log(`  ${isMatch ? '✅' : '❌'} User ID: ${s.user_id} ${isMatch ? '(MATCH!)' : ''}`);
            console.log(`     Email: ${s.account_email}`);
            console.log(`     Status: ${s.status}`);
            console.log(`     Created: ${s.created_at}`);
        });
    }
}

checkDemoUserToken().catch(console.error);
