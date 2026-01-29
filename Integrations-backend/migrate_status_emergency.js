
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function run() {
    const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const sql = `
    ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;
    ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
      CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed', 'quarantined_dangerous_doc', 'duplicate_blocked', 'already_reimbursed', 'pending_approval'));
  `;
    const { data, error } = await s.rpc('exec_sql', { sql_query: sql });
    if (error) console.error(error);
    else console.log('✅ Migration Applied');
}
run();
