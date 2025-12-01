import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const UUID = '78fecfc0-5bf7-4387-9084-38d4733b9649';

async function checkTokens() {
    console.log(`🔍 Checking tokens for UUID: ${UUID}\n`);

    // TEST WRITE
    console.log('Testing write access...');
    const { error: insertError } = await supabase
        .from('tokens')
        .upsert({
            user_id: UUID,
            provider: 'test-provider',
            access_token_iv: 'test',
            access_token_data: 'test',
            expires_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

    if (insertError) {
        console.error('❌ Write failed:', insertError);
    } else {
        console.log('✅ Write successful');
    }

    const { data: tokens, error } = await supabase
        .from('tokens')
        .select('*')
        .eq('user_id', UUID);

    if (error) {
        console.error('❌ Error fetching tokens:', error);
    } else {
        console.log(`Found ${tokens.length} tokens:`);
        tokens.forEach(t => {
            console.log(`- Provider: ${t.provider}`);
            console.log(`  ID: ${t.id}`);
            console.log(`  Access Token IV: ${t.access_token_iv ? 'present' : 'NULL'}`);
            console.log(`  Access Token Data: ${t.access_token_data ? 'present' : 'NULL'}`);
            console.log(`  Refresh Token IV: ${t.refresh_token_iv ? 'present' : 'NULL'}`);
            console.log(`  Refresh Token Data: ${t.refresh_token_data ? 'present' : 'NULL'}`);
            console.log(`  Expires: ${t.expires_at}`);
            console.log(`  Updated: ${t.updated_at}`);
        });
    }
}

checkTokens();
