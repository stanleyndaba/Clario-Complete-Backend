import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.AMAZON_SPAPI_BASE_URL = process.env.AMAZON_SPAPI_BASE_URL || 'https://sellingpartnerapi-na.amazon.com';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

async function run() {
  const userId = process.argv[2];
  const tenantId = process.argv[3];
  if (!userId || !tenantId) {
    throw new Error('Usage: ts-node src/scripts/verify-agent2-live-tenant-sync.ts <userId> <tenantId>');
  }

  const { agent2DataSyncService } = await import('../services/agent2DataSyncService');

  console.log(`START_TENANT_SYNC user=${userId} tenant=${tenantId}`);
  try {
    const result = await agent2DataSyncService.syncUserData(userId, undefined, undefined, undefined, undefined, tenantId);
    console.log(`TENANT_SYNC_OK ${JSON.stringify(result)}`);
  } catch (error: any) {
    console.log(`TENANT_SYNC_ERR ${error?.message || String(error)}`);
  }
}

run().catch((error) => {
  console.error(`FATAL ${error?.message || String(error)}`);
  process.exit(1);
});
