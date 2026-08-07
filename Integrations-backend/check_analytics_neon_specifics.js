const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_KDfZyx43laMs@ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });

  try {
    await client.connect();
    
    // Check specific events
    const demoStartedRes = await client.query("SELECT count(*) FROM public_analytics_events WHERE event_name = 'demo_started';");
    console.log(`demo_started events: ${demoStartedRes.rows[0].count}`);

    const earlyAccessRes = await client.query("SELECT count(*) FROM public_analytics_events WHERE event_name = 'early_access_viewed';");
    console.log(`early_access_viewed events: ${earlyAccessRes.rows[0].count}`);
    
    // Check for '/app' visits in last 3 hours
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const appVisitsRes = await client.query(`
      SELECT count(*) FROM public_analytics_events 
      WHERE page_path = '/app' AND created_at > $1;
    `, [threeHoursAgo]);
    console.log(`/app visits in last 3 hours: ${appVisitsRes.rows[0].count}`);

    // Total unique visitors by Geo (Hounslow and Ashburn) - or check traffic source hint
    const uniqueIPs = await client.query("SELECT COUNT(DISTINCT ip_hash) FROM public_analytics_events;");
    console.log(`Unique IP hashes: ${uniqueIPs.rows[0].count}`);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
