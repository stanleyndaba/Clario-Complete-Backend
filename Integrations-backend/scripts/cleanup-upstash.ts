import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';
import Queue from 'bull';

// The production/external Redis URL that might be hosting the rogue jobs
const REDIS_URL = 'rediss://default:AXo5AAIncDI1YTAyZDM2OGQyNWE0NGEyYjM3M2NmMWJlNjllNzI5MXAyMzEyODk@allowing-akita-31289.upstash.io:6379';

async function main() {
  console.log('🧹 Cleaning Evidence Ingestion Queue on UPSTASH...');
  
  // 1. Clear BullMQ Queues
  const evidenceQueue = new Queue('evidence_ingestion', REDIS_URL);
  
  console.log('Fetching job counts...');
  const counts = await evidenceQueue.getJobCounts();
  console.log('Job counts:', counts);

  console.log('Emptying queue...');
  await evidenceQueue.empty();
  await evidenceQueue.clean(0, 'delayed');
  await evidenceQueue.clean(0, 'wait');
  await evidenceQueue.clean(0, 'active');
  await evidenceQueue.clean(0, 'completed');
  await evidenceQueue.clean(0, 'failed');
  
  console.log('✅ queue emptied and cleaned.');
  
  const countsAfter = await evidenceQueue.getJobCounts();
  console.log('Job counts after:', countsAfter);

  await evidenceQueue.close();

  // 2. Clear out other queues just in case
  const orchQueue = new Queue('orchestration', REDIS_URL);
  await orchQueue.empty();
  await orchQueue.clean(0, 'delayed');
  await orchQueue.clean(0, 'wait');
  await orchQueue.clean(0, 'active');
  await orchQueue.clean(0, 'failed');
  await orchQueue.close();
  
  console.log('✅ cleanup finished');
  process.exit(0);
}

main().catch(console.error);
