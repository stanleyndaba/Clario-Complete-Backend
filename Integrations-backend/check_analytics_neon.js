const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_KDfZyx43laMs@ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });

  try {
    await client.connect();
    
    const eventsRes = await client.query("SELECT count(*) FROM public_analytics_events;");
    console.log(`public_analytics_events count: ${eventsRes.rows[0].count}`);

    const sessionsRes = await client.query("SELECT count(*) FROM public_analytics_session_intent;");
    console.log(`public_analytics_session_intent count: ${sessionsRes.rows[0].count}`);
    
    if (sessionsRes.rows[0].count > 0) {
      const recentSessions = await client.query("SELECT * FROM public_analytics_session_intent ORDER BY created_at DESC LIMIT 5;");
      console.log("Recent 5 sessions:");
      console.log(recentSessions.rows);
    }

    if (eventsRes.rows[0].count > 0) {
      const recentEvents = await client.query("SELECT * FROM public_analytics_events ORDER BY created_at DESC LIMIT 5;");
      console.log("Recent 5 events:");
      console.log(recentEvents.rows);
    }

    const visitorsRes = await client.query("SELECT count(*) FROM public_analytics_visitor_intent;");
    console.log(`public_analytics_visitor_intent count: ${visitorsRes.rows[0].count}`);
    if (visitorsRes.rows[0].count > 0) {
       const recentVisitors = await client.query("SELECT * FROM public_analytics_visitor_intent ORDER BY created_at DESC LIMIT 5;");
       console.log("Recent 5 visitors:");
       console.log(recentVisitors.rows);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
