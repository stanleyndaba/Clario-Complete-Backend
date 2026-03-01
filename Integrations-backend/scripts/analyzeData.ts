import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = '00000000-0000-0000-0000-000000000000';

async function run() {
    console.log("📊 Analyzing financial_events for dummy user...");
    const { data: feData } = await supabase
        .from('financial_events')
        .select('event_type, amount, amazon_order_id, amazon_sku')
        .eq('seller_id', userId);

    console.log("Financial Events Summary:");
    const feSummary = feData?.reduce((acc: any, row: any) => {
        acc[row.event_type] = (acc[row.event_type] || 0) + 1;
        return acc;
    }, {});
    console.log(feSummary);
    console.log("Sample Rows:", feData?.slice(0, 3));

    console.log("\n📊 Analyzing returns for dummy user...");
    const { data: returnsData } = await supabase
        .from('returns')
        .select('return_id, order_id, status, items')
        .eq('user_id', userId);

    console.log("Returns Count:", returnsData?.length);
    console.log("Sample Returns:", JSON.stringify(returnsData?.slice(0, 1), null, 2));
}

run();
