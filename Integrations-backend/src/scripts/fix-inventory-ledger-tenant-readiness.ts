import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function run(): Promise<void> {
  const before = await supabase
    .from('inventory_ledger')
    .select('id', { count: 'exact', head: true })
    .is('tenant_id', null);

  if (before.error) {
    throw new Error(`Failed pre-check: ${before.error.message}`);
  }

  console.log(`before_null_tenant=${before.count ?? 0}`);

  const update = await supabase
    .from('inventory_ledger')
    .update({ tenant_id: DEFAULT_TENANT_ID })
    .is('tenant_id', null);

  if (update.error) {
    throw new Error(`Failed update: ${update.error.message}`);
  }

  const after = await supabase
    .from('inventory_ledger')
    .select('id', { count: 'exact', head: true })
    .is('tenant_id', null);

  const defaultTenantCount = await supabase
    .from('inventory_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', DEFAULT_TENANT_ID);

  const total = await supabase
    .from('inventory_ledger')
    .select('id', { count: 'exact', head: true });

  if (after.error || defaultTenantCount.error || total.error) {
    throw new Error(
      `Failed post-check: ${after.error?.message || defaultTenantCount.error?.message || total.error?.message}`
    );
  }

  console.log(`after_null_tenant=${after.count ?? 0}`);
  console.log(`default_tenant_rows=${defaultTenantCount.count ?? 0}`);
  console.log(`total_rows=${total.count ?? 0}`);
}

run().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
