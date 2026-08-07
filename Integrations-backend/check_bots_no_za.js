const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_KDfZyx43laMs@ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });

  try {
    await client.connect();
    
    console.log("--- Events Breakdown (Excluding ZA) ---");
    const eventsRes = await client.query(`
      SELECT is_likely_bot, is_internal_test, is_demo_session, count(*) 
      FROM public_analytics_events 
      WHERE geo_country IS DISTINCT FROM 'ZA' AND geo_country IS DISTINCT FROM 'South Africa'
      GROUP BY is_likely_bot, is_internal_test, is_demo_session;
    `);
    
    let totalRealEvents = 0;
    let totalBotEvents = 0;

    eventsRes.rows.forEach(r => {
      console.log(`is_likely_bot = ${r.is_likely_bot}, is_internal_test = ${r.is_internal_test}, is_demo_session = ${r.is_demo_session}: ${r.count}`);
      if (r.is_likely_bot === false) {
          totalRealEvents += parseInt(r.count, 10);
      } else {
          totalBotEvents += parseInt(r.count, 10);
      }
    });
    console.log(`Total Real Events (excluding ZA): ${totalRealEvents}`);
    console.log(`Total Bot/Test Events (excluding ZA): ${totalBotEvents}`);

    console.log("\n--- Session Intent Bot Breakdown (Excluding ZA events sessions) ---");
    // Sessions that have at least one event not from ZA
    const sessionsRes = await client.query(`
      SELECT s.is_likely_bot, s.is_internal_test, count(DISTINCT s.analytics_session_id) 
      FROM public_analytics_session_intent s
      JOIN public_analytics_events e ON s.analytics_session_id = e.analytics_session_id
      WHERE e.geo_country IS DISTINCT FROM 'ZA' AND e.geo_country IS DISTINCT FROM 'South Africa'
      GROUP BY s.is_likely_bot, s.is_internal_test
      ORDER BY s.is_likely_bot;
    `);

    let totalRealSessions = 0;
    let totalBotSessions = 0;

    sessionsRes.rows.forEach(r => {
      console.log(`is_likely_bot = ${r.is_likely_bot}, is_internal_test = ${r.is_internal_test}: ${r.count}`);
      if (r.is_likely_bot === false) {
          totalRealSessions += parseInt(r.count, 10);
      } else {
          totalBotSessions += parseInt(r.count, 10);
      }
    });

    console.log(`Total Real Sessions (excluding ZA): ${totalRealSessions}`);
    console.log(`Total Bot/Test Sessions (excluding ZA): ${totalBotSessions}`);

    console.log("\n--- Visitor Intent Bot Breakdown (Excluding ZA events visitors) ---");
    const visitorsRes = await client.query(`
      SELECT v.is_likely_bot, count(DISTINCT v.anonymous_id) 
      FROM public_analytics_visitor_intent v
      JOIN public_analytics_events e ON v.anonymous_id = e.anonymous_id
      WHERE e.geo_country IS DISTINCT FROM 'ZA' AND e.geo_country IS DISTINCT FROM 'South Africa'
      GROUP BY v.is_likely_bot;
    `);

    let totalRealVisitors = 0;
    let totalBotVisitors = 0;
    
    visitorsRes.rows.forEach(r => {
      console.log(`is_likely_bot = ${r.is_likely_bot}: ${r.count}`);
      if (r.is_likely_bot === false) {
          totalRealVisitors += parseInt(r.count, 10);
      } else {
          totalBotVisitors += parseInt(r.count, 10);
      }
    });

    console.log(`Total Real Visitors (excluding ZA): ${totalRealVisitors}`);
    console.log(`Total Bot/Test Visitors (excluding ZA): ${totalBotVisitors}`);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
