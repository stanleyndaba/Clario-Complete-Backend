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

async function checkRecentTokens() {
    console.log('Checking most recent tokens (all providers)...\n');

    const { data: tokens, error } = await supabase
        .from('tokens')
        .select('user_id, provider, created_at, expires_at')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error:', error);
    } else if (!tokens || tokens.length === 0) {
        console.log('❌ NO TOKENS FOUND IN DATABASE');
    } else {
        console.log(`Found ${tokens.length} most recent tokens:\n`);
        tokens.forEach((t, i) => {
            console.log(`${i + 1}. ${t.provider.toUpperCase()}`);
            console.log(`   User ID: ${t.user_id}`);
            console.log(`   Created: ${t.created_at}`);
            console.log(`   Expires: ${t.expires_at}`);
            console.log('');
        });
    }
}

checkRecentTokens().catch(console.error);
