const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:Lungilemzila@75@db.fmzfjhrwbkebqaxjlvzt.supabase.co:5432/postgres?sslmode=require',
  ssl: false
});

async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT 1 as test');
    console.log('✅ Connection successful:', result.rows[0]);
    client.release();
    process.exit(0);
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
