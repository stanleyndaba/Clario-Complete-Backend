import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    console.log("🔍 Checking for financial_impact_events table...");
    const { error } = await supabase
        .from('financial_impact_events')
        .select('id')
        .limit(1);

    if (error) {
        console.log("❌ Table does not exist or error:", error.message);
        if (error.message.includes("relation \"financial_impact_events\" does not exist")) {
            console.log("Table MISSING. Migration REQUIRED.");
        }
    } else {
        console.log("✅ Table EXISTS.");
    }
}

run();
