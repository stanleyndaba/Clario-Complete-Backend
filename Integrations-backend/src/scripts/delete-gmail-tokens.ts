
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

async function deleteAllGmailTokens() {
    console.log('Deleting all Gmail tokens from database...');

    const { data, error } = await supabase
        .from('tokens')
        .delete()
        .eq('provider', 'gmail');

    if (error) {
        console.error('Error deleting tokens:', error);
    } else {
        console.log('✅ All Gmail tokens deleted successfully');
        console.log('You can now reconnect Gmail with the correct encryption key');
    }
}

deleteAllGmailTokens().catch(console.error);
