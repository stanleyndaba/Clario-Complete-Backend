import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    const { data: feData } = await supabase
        .from('financial_events')
        .select('event_date')
        .limit(5);

    console.log("Financial Events Dates:", feData);

    const { data: returnsData } = await supabase
        .from('returns')
        .select('returned_date')
        .limit(5);

    console.log("Returns Dates:", returnsData);
}

run();
