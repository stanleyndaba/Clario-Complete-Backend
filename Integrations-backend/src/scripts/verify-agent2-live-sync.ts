import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.AMAZON_SPAPI_BASE_URL = process.env.AMAZON_SPAPI_BASE_URL || 'https://sellingpartnerapi-na.amazon.com';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

async function run() {
  const userId = process.argv[2];
  if (!userId) {
    throw new Error('Usage: ts-node src/scripts/verify-agent2-live-sync.ts <userId>');
  }

  const { syncJobManager } = await import('../services/syncJobManager');

  console.log(`START_SYNC user=${userId}`);
  try {
    const result = await syncJobManager.startSync(userId);
    console.log(`START_SYNC_OK ${JSON.stringify(result)}`);
  } catch (error: any) {
    console.log(`START_SYNC_ERR ${error?.message || String(error)}`);
  }
}

run().catch((error) => {
  console.error(`FATAL ${error?.message || String(error)}`);
  process.exit(1);
});
