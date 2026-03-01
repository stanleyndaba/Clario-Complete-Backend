import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const userId = '00000000-0000-0000-0000-000000000000';

async function run() {
    console.log("🚚 Migrating financial_events -> settlements for dummy user...");

    // 1. Get the data
    const { data: feData } = await supabase
        .from('financial_events')
        .select('*')
        .eq('seller_id', userId);

    if (!feData || feData.length === 0) {
        console.log("Nothing to migrate.");
        return;
    }

    // 2. Map to settlements
    const settlementRows = feData.map(row => ({
        id: uuidv4(),
        user_id: userId,
        settlement_id: `migrated_${row.id}`,
        order_id: row.amazon_order_id,
        transaction_type: row.event_type === 'return' ? 'refund' : row.event_type,
        amount: row.amount,
        currency: row.currency || 'USD',
        settlement_date: row.event_date,
        sync_id: row.sync_id || 'migrated',
        source: 'csv_upload',
        metadata: { sku: row.amazon_sku },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }));

    // 3. Insert into settlements
    const { error: insError } = await supabase
        .from('settlements')
        .insert(settlementRows);

    if (insError) {
        console.error("❌ Migration failed:", insError);
    } else {
        console.log(`✅ Successfully migrated ${settlementRows.length} rows to settlements table.`);
    }
}

run();
