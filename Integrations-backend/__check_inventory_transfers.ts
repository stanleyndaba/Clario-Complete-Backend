import { supabaseAdmin } from './src/database/supabaseClient';

async function main() {
  const { data, error } = await supabaseAdmin.from('inventory_transfers').select('*').limit(1);
  console.log(JSON.stringify({ data, error }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
