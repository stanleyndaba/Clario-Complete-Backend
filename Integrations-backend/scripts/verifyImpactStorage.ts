import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = '00000000-0000-0000-0000-000000000000';

async function run() {
    console.log("📊 Final Verification: Checking financial_impact_events table...");

    const { data, error } = await supabase
        .from('financial_impact_events')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("❌ Error fetching results:", error);
        return;
    }

    console.log(`✅ Found ${data?.length || 0} impact events in database.`);

    const totalValue = data?.reduce((sum, r) => sum + parseFloat(String(r.estimated_amount || 0)), 0);
    console.log(`💰 Total Dashboard Recovery Value ($): ${totalValue?.toFixed(2)}`);

    if (data && data.length > 0) {
        console.log("\nSample Impact Events:");
        data.slice(0, 3).forEach(event => {
            console.log(`- [${event.status}] ${event.anomaly_type}: $${event.estimated_amount} (ID: ${event.detection_id})`);
        });
    }
}

run();
