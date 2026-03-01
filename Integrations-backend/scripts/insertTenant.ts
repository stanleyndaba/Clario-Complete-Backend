import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Force load env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
    console.log("Directly inserting dummy tenant into standard Postgres instance (bypassing mock mode)...");

    const { data, error } = await supabase
        .from('tenants')
        .upsert({
            id: '00000000-0000-0000-0000-000000000000',
            name: 'System Demo Tenant',
            slug: 'system-demo-tenant'
        });

    if (error) {
        console.error("Insertion failed:", error);
    } else {
        console.log("Tenant inserted securely. UUID is now safe for foreign keys.");
    }
}

run();
