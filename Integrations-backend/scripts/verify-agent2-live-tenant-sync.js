const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const userId = process.argv[2];
  const tenantId = process.argv[3];
  if (!userId || !tenantId) {
    throw new Error('Usage: node scripts/verify-agent2-live-tenant-sync.js <userId> <tenantId>');
  }

  console.log('STEP require service');
  const { agent2DataSyncService } = require('../dist/services/agent2DataSyncService');
  console.log('STEP service loaded');

  console.log(`START_TENANT_SYNC user=${userId} tenant=${tenantId}`);
  try {
    const result = await agent2DataSyncService.syncUserData(
      userId,
      undefined,
      undefined,
      undefined,
      undefined,
      tenantId
    );
    console.log(`TENANT_SYNC_OK ${JSON.stringify(result)}`);
  } catch (error) {
    console.log(`TENANT_SYNC_ERR ${error?.message || String(error)}`);
  }
}

run().catch((error) => {
  console.error(`FATAL ${error?.message || String(error)}`);
  process.exit(1);
});
