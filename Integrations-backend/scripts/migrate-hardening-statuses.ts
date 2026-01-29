
import 'dotenv/config';
import { supabaseAdmin } from './src/database/supabaseClient';

async function runMigration() {
    const sql = `
    ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;
    ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
      CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed', 'quarantined_dangerous_doc', 'duplicate_blocked', 'already_reimbursed', 'pending_approval'));
  `;

    console.log('🚀 Applying Migration 045...');
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });

    if (error) {
        console.error('❌ Migration Failed:', error);
        process.exit(1);
    }

    console.log('✅ Migration Successful!');
    process.exit(0);
}

runMigration().catch(console.error);
