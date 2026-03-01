import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = '00000000-0000-0000-0000-000000000000';

async function run() {
    console.log("🧐 Double checking settlements data for query compatibility...");

    const { data, error } = await supabase
        .from('settlements')
        .select('transaction_type, amount, user_id, settlement_date')
        .eq('user_id', userId);

    if (error) {
        console.error("Query Error:", error);
        return;
    }

    console.log(`Found ${data.length} rows in settlements.`);
    console.log("Sample rows:", data.slice(0, 5));

    const types = data.map(d => d.transaction_type);
    console.log("Unique types found:", [...new Set(types)]);

    // Simulate the Agent 3 query
    const filtered = data.filter(d => ['refund', 'fee', 'shipment_fee'].includes(d.transaction_type));
    console.log(`Rows matching Agent 3 filter: ${filtered.length}`);
}

run();
