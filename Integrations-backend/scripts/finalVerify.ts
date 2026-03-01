import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = '00000000-0000-0000-0000-000000000000';

async function run() {
    console.log("📊 Final Verification: Checking detection_results table...");

    const { data, error } = await supabase
        .from('detection_results')
        .select('anomaly_type, estimated_value, status, created_at')
        .eq('seller_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("❌ Error fetching results:", error);
        return;
    }

    console.log(`✅ Found ${data?.length || 0} detection results in database.`);

    const summary = data?.reduce((acc: any, row: any) => {
        acc[row.anomaly_type] = (acc[row.anomaly_type] || 0) + 1;
        return acc;
    }, {});

    console.log("Anomaly Type Summary:");
    console.log(summary);

    const totalValue = data?.reduce((sum, r) => sum + (r.estimated_value || 0), 0);
    console.log(`💰 Total Estimated Recovery: $${totalValue?.toFixed(2)}`);
}

run();
