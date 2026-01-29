
const { Client } = require('pg');

async function run() {
    const connectionString = "postgresql://postgres:Lungilemzila%4075@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";

    const client = new Client({
        connectionString,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('✅ Connected to PG');

        const sql = `
      ALTER TABLE dispute_cases DROP CONSTRAINT IF EXISTS dispute_cases_filing_status_check;
      ALTER TABLE dispute_cases ADD CONSTRAINT dispute_cases_filing_status_check 
        CHECK (filing_status IN ('pending', 'filing', 'filed', 'retrying', 'failed', 'quarantined_dangerous_doc', 'duplicate_blocked', 'already_reimbursed', 'pending_approval'));
    `;

        console.log('🚀 Applying Migration 045 (Direct PG with SSL bypass)...');
        await client.query(sql);
        console.log('✅ Migration Successful!');
    } catch (err) {
        console.error('❌ Migration Failed:', err);
    } finally {
        await client.end();
    }
}
run();
