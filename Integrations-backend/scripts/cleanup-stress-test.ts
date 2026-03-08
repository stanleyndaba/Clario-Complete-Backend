import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import Queue from 'bull';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function main() {
  console.log('🧹 Cleaning Evidence Ingestion Queue...');
  
  // 1. Clear BullMQ Queues
  const evidenceQueue = new Queue('evidence_ingestion', REDIS_URL);
  await evidenceQueue.empty();
  console.log('✅ queue emptied.');
  await evidenceQueue.close();

  console.log('🧹 Cleaning Test Data from Supabase...');
  // 2. Delete test data from Supabase DB where user_id starts with 'stress-test-user'
  
  try {
    const { error: err1 } = await supabaseAdmin.from('evidence_sources').delete().like('seller_id', 'stress-test-user-%');
    if (err1) console.error('Error deleting sources:', err1.message);
    else console.log('✅ test sources deleted');

    const { error: err2 } = await supabaseAdmin.from('evidence_ingestion_errors').delete().like('user_id', 'stress-test-user-%');
    if (err2) console.error('Error deleting errors:', err2.message);
    else console.log('✅ test ingestion errors deleted');

    // agent_events uses user_id?
    const { error: err3 } = await supabaseAdmin.from('agent_events').delete().like('user_id', 'stress-test-user-%');
    if (err3) console.error('Error deleting agent events:', err3.message);
    else console.log('✅ test agent events deleted');

  } catch(e) {
    console.error(e);
  }
  
  process.exit(0);
}

main();
