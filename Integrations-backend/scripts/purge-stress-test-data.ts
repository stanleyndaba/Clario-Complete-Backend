import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function purgeStressTestData() {
  console.log('🧹 Aggressively purging stress test data from Supabase...');

  const prefixes = ['stress-test-user-%'];

  for (const prefix of prefixes) {
    try {
      // 1. Purge evidence_sources by seller_id
      const { error: e1 } = await supabaseAdmin
        .from('evidence_sources')
        .delete()
        .like('seller_id', prefix);
      if (e1) console.error('Error evidence_sources seller_id:', e1.message);

      // 2. Purge evidence_sources by user_id
      const { error: e2 } = await supabaseAdmin
        .from('evidence_sources')
        .delete()
        .like('user_id', prefix);
      if (e2 && !e2.message.includes('column "user_id" does not exist')) {
          console.error('Error evidence_sources user_id:', e2.message);
      }

      // 3. Purge agent_events
      const { error: e3 } = await supabaseAdmin
        .from('agent_events')
        .delete()
        .like('user_id', prefix);
      if (e3) console.error('Error agent_events:', e3.message);

      // 4. Purge evidence_ingestion_errors
      const { error: e4 } = await supabaseAdmin
        .from('evidence_ingestion_errors')
        .delete()
        .like('user_id', prefix);
      if (e4) console.error('Error evidence_ingestion_errors:', e4.message);

      // Print how many sources are left just in case there are other patterns
      const { data: remaining, error: e5 } = await supabaseAdmin
        .from('evidence_sources')
        .select('seller_id, user_id, provider')
        .limit(10);
      
      console.log('Sample remaining evidence sources:', remaining);

    } catch (e) {
      console.error(e);
    }
  }

  console.log('✅ Purge complete.');
}

purgeStressTestData();
