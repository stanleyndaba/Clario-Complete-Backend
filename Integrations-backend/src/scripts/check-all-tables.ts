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

async function checkAllTables() {
    const tables = ['orders', 'shipments', 'returns', 'settlements', 'inventory', 'detection_results', 'claims'];

    console.log('📊 Checking database tables...');

    for (const table of tables) {
        try {
            const { count, error } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });

            if (error) {
                console.log(`❌ ${table}: Error - ${error.message}`);
            } else {
                console.log(`✅ ${table}: ${count} records`);
            }
        } catch (e: any) {
            console.log(`❌ ${table}: Exception - ${e.message}`);
        }
    }
}

checkAllTables();
