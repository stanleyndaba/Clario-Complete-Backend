
require('dotenv').config();
const { Client } = require('pg');

async function run() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('❌ Missing DATABASE_URL');
        process.exit(1);
    }

    const client = new Client({ connectionString });
    await client.connect();

    const sql = `
    ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;
    ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
      CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed', 'quarantined_dangerous_doc', 'duplicate_blocked', 'already_reimbursed', 'pending_approval'));
  `;

    try {
        console.log('🚀 Applying Migration 045 (Direct PG)...');
        await client.query(sql);
        console.log('✅ Migration Successful!');
    } catch (err) {
        console.error('❌ Migration Failed:', err);
    } finally {
        await client.end();
    }
}
run();
