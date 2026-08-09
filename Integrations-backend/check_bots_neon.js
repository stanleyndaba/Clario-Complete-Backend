const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_KDfZyx43laMs@ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });

  try {
    await client.connect();
    
    console.log("--- Visitor Intent Bot Breakdown ---");
    const visitorsRes = await client.query("SELECT is_likely_bot, count(*) FROM public_analytics_visitor_intent GROUP BY is_likely_bot;");
    visitorsRes.rows.forEach(r => {
      console.log(`is_likely_bot = ${r.is_likely_bot}: ${r.count}`);
    });

    console.log("\n--- Session Intent Bot Breakdown ---");
    const sessionsRes = await client.query("SELECT is_likely_bot, is_internal_test, count(*) FROM public_analytics_session_intent GROUP BY is_likely_bot, is_internal_test ORDER BY is_likely_bot;");
    sessionsRes.rows.forEach(r => {
      console.log(`is_likely_bot = ${r.is_likely_bot}, is_internal_test = ${r.is_internal_test}: ${r.count}`);
    });

    console.log("\n--- Events Breakdown ---");
    const eventsRes = await client.query("SELECT is_likely_bot, is_internal_test, is_demo_session, count(*) FROM public_analytics_events GROUP BY is_likely_bot, is_internal_test, is_demo_session;");
    eventsRes.rows.forEach(r => {
      console.log(`is_likely_bot = ${r.is_likely_bot}, is_internal_test = ${r.is_internal_test}, is_demo_session = ${r.is_demo_session}: ${r.count}`);
    });

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
