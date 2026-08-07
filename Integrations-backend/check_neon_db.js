const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_KDfZyx43laMs@ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });

  try {
    await client.connect();
    console.log("Connected to Neon DB.");
    
    // Check tables
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';");
    console.log("Tables:");
    console.log(res.rows.map(r => r.table_name).join(', '));
    
    if (res.rows.some(r => r.table_name === 'users')) {
      const usersRes = await client.query("SELECT count(*) FROM users;");
      console.log(`Users count: ${usersRes.rows[0].count}`);
      
      const lastUsers = await client.query("SELECT * FROM users ORDER BY created_at DESC LIMIT 5;");
      console.log("Last 5 users:");
      console.log(lastUsers.rows);
    } else {
        console.log("No users table found.");
    }

    if (res.rows.some(r => r.table_name === 'events')) {
      const eventsRes = await client.query("SELECT count(*) FROM events;");
      console.log(`Events count: ${eventsRes.rows[0].count}`);

      const recentEvents = await client.query("SELECT * FROM events ORDER BY created_at DESC LIMIT 5;");
      console.log("Recent 5 events:");
      console.log(recentEvents.rows);
    } else {
      console.log("No events table found.");
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
