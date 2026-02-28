/**
 * Quick migration runner — executes 063_create_csv_data_tables.sql via Supabase direct Postgres connection.
 * Usage: npx ts-node scripts/run-migration-063.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import 'dotenv/config';

async function main() {
    // Supabase direct connection (pooler in transaction mode doesn't support DDL well)
    // Format: postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');

    // Try DATABASE_URL first, then construct from Supabase project ref
    let connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        // Use Supabase direct connection
        const password = process.env.SUPABASE_DB_PASSWORD;
        if (password) {
            connectionString = `postgresql://postgres.${projectRef}:${password}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
        }
    }

    if (!connectionString) {
        console.log('No DATABASE_URL or SUPABASE_DB_PASSWORD found.');
        console.log('Falling back to Supabase JS client approach...');

        // Fallback: use supabase-js with rpc
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false } }
        );

        // Read the SQL file
        const sqlPath = join(__dirname, '..', 'migrations', '063_create_csv_data_tables.sql');
        const sql = readFileSync(sqlPath, 'utf-8');

        // Split by semicolons and execute each statement
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        console.log(`Found ${statements.length} SQL statements to execute`);

        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            const preview = stmt.substring(0, 80).replace(/\n/g, ' ');

            try {
                const { error } = await supabase.rpc('exec_sql', { query: stmt });
                if (error) {
                    // Try direct query via postgrest (won't work for DDL but let's try)
                    console.log(`  Statement ${i + 1}: ${preview}...`);
                    console.log(`  ⚠️  RPC failed: ${error.message}`);
                } else {
                    console.log(`  ✅ Statement ${i + 1}: ${preview}...`);
                }
            } catch (err: any) {
                console.log(`  ❌ Statement ${i + 1} failed: ${err.message}`);
            }
        }

        console.log('\n⚠️  If statements failed, please run the SQL manually in Supabase SQL Editor:');
        console.log('   1. Go to https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
        console.log('   2. Paste the contents of migrations/063_create_csv_data_tables.sql');
        console.log('   3. Click "Run"');
        return;
    }

    // Direct pg connection
    const client = new Client({ connectionString });

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('✅ Connected');

        const sqlPath = join(__dirname, '..', 'migrations', '063_create_csv_data_tables.sql');
        const sql = readFileSync(sqlPath, 'utf-8');

        console.log('Running migration 063_create_csv_data_tables.sql...');
        await client.query(sql);
        console.log('✅ Migration complete — all 5 tables created!');
        console.log('   - orders');
        console.log('   - shipments');
        console.log('   - returns');
        console.log('   - settlements');
        console.log('   - inventory_items');
    } catch (err: any) {
        console.error('❌ Migration failed:', err.message);
    } finally {
        await client.end();
    }
}

main();
