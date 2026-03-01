import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Import the internal admin client
import { supabaseAdmin } from '../src/database/supabaseClient';
const userId = '00000000-0000-0000-0000-000000000000';

async function run() {
    console.log(`🔍 Internal Client Test: Fetching settlements for ${userId}...`);

    const { data, error } = await supabaseAdmin
        .from('settlements')
        .select('transaction_type, id')
        .eq('user_id', userId);

    if (error) {
        console.error("❌ Internal Client Error:", error);
    } else {
        console.log(`✅ Internal Client Found ${data?.length || 0} rows.`);
        if (data && data.length > 0) {
            console.log("Types:", [...new Set(data.map((d: any) => d.transaction_type))]);
        }
    }
}

run();
