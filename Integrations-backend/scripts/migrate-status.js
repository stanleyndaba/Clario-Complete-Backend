
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function runMigration() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('❌ Missing environment variables');
        process.exit(1);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const sql = `
    ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;
    ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
      CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed', 'quarantined_dangerous_doc', 'duplicate_blocked', 'already_reimbursed', 'pending_approval'));
  `;

    console.log('🚀 Applying Migration 045 (JS)...');
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });

    if (error) {
        console.error('❌ Migration Failed:', error);
        process.exit(1);
    }

    console.log('✅ Migration Successful!');
    process.exit(0);
}

runMigration().catch(console.error);
