const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_KDfZyx43laMs@ep-purple-sun-ata5l2u7.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });

  try {
    await client.connect();
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    console.log(`Analyzing data since: ${oneDayAgo}`);

    console.log("\n--- Events Breakdown (Last 24h, Excluding ZA) ---");
    const eventsRes = await client.query(`
      SELECT is_likely_bot, is_internal_test, is_demo_session, count(*) 
      FROM public_analytics_events 
      WHERE geo_country IS DISTINCT FROM 'ZA' AND geo_country IS DISTINCT FROM 'South Africa'
      AND created_at >= $1
      GROUP BY is_likely_bot, is_internal_test, is_demo_session;
    `, [oneDayAgo]);
    
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
    console.log(`Total Real Events (Last 24h, excl ZA): ${totalRealEvents}`);
    console.log(`Total Bot/Test Events (Last 24h, excl ZA): ${totalBotEvents}`);

    console.log("\n--- Session Intent Bot Breakdown (Last 24h, Excluding ZA) ---");
    // Sessions that have at least one event in the last 24h not from ZA
    const sessionsRes = await client.query(`
      SELECT s.is_likely_bot, s.is_internal_test, count(DISTINCT s.analytics_session_id) 
      FROM public_analytics_session_intent s
      JOIN public_analytics_events e ON s.analytics_session_id = e.analytics_session_id
      WHERE e.geo_country IS DISTINCT FROM 'ZA' AND e.geo_country IS DISTINCT FROM 'South Africa'
      AND s.created_at >= $1
      GROUP BY s.is_likely_bot, s.is_internal_test
      ORDER BY s.is_likely_bot;
    `, [oneDayAgo]);

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

    console.log(`Total Real Sessions (Last 24h, excl ZA): ${totalRealSessions}`);
    console.log(`Total Bot/Test Sessions (Last 24h, excl ZA): ${totalBotSessions}`);

    console.log("\n--- Visitor Intent Bot Breakdown (Last 24h, Excluding ZA) ---");
    const visitorsRes = await client.query(`
      SELECT v.is_likely_bot, count(DISTINCT v.anonymous_id) 
      FROM public_analytics_visitor_intent v
      JOIN public_analytics_events e ON v.anonymous_id = e.anonymous_id
      WHERE e.geo_country IS DISTINCT FROM 'ZA' AND e.geo_country IS DISTINCT FROM 'South Africa'
      AND v.created_at >= $1
      GROUP BY v.is_likely_bot;
    `, [oneDayAgo]);

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

    console.log(`Total Real Visitors (Last 24h, excl ZA): ${totalRealVisitors}`);
    console.log(`Total Bot/Test Visitors (Last 24h, excl ZA): ${totalBotVisitors}`);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main();
