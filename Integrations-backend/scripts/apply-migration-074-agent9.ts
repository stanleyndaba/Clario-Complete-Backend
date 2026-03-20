import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  const sql = readFileSync(
    join(__dirname, '..', 'migrations', '074_align_billing_to_recovery_credit_model.sql'),
    'utf-8'
  );

  let error: any = null;
  let lastTried: string | null = null;

  for (const payload of [
    { sql_query: sql },
    { query: sql }
  ]) {
    lastTried = Object.keys(payload)[0];
    const response = await supabase.rpc('exec_sql', payload as any);
    if (!response.error) {
      console.log(`✅ Migration 074 applied using exec_sql(${lastTried})`);
      return;
    }
    error = response.error;
  }

  throw new Error(`Migration 074 failed via exec_sql(${lastTried}): ${error?.message || 'unknown error'}`);
}

main().catch((error) => {
  console.error('❌', error.message);
  process.exit(1);
});
