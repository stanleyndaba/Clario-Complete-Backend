
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function checkAgent1Data() {
  try {
    await client.connect();
    console.log('✅ Connected to DB');

    const users = await client.query('SELECT count(*) FROM users');
    console.log(`👥 Users count: ${users.rows[0].count}`);

    const tokens = await client.query('SELECT count(*) FROM tokens');
    console.log(`🔑 Tokens count: ${tokens.rows[0].count}`);

    // Show the most recent user (if any)
    if (parseInt(users.rows[0].count) > 0) {
        const lastUser = await client.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 1');
        console.log('👤 Last User Created:', lastUser.rows[0]);
    }

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await client.end();
  }
}

checkAgent1Data();

