import 'dotenv/config';
import { Client } from 'pg';

async function verifyTables() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE' 
      ORDER BY table_name
    `);
    
    const tables = result.rows.map(r => r.table_name);
    console.log(`\n📊 Found ${tables.length} tables:\n`);
    tables.forEach(t => console.log(`   - ${t}`));
    
    // Check for key agent tables
    const keyTables = [
      'tokens', 'users', 'sync_progress', 'detection_queue', 'detection_results',
      'evidence_sources', 'evidence_documents', 'dispute_cases', 'recoveries',
      'billing_transactions', 'notifications', 'agent_events', 'learning_metrics'
    ];
    
    console.log('\n🔍 Key Agent Tables Status:');
    keyTables.forEach(table => {
      const exists = tables.includes(table);
      console.log(`   ${exists ? '✅' : '❌'} ${table}`);
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyTables();

