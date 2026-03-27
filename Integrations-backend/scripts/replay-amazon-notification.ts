import 'dotenv/config';
import logger from '../src/utils/logger';
import amazonNotificationService from '../src/services/amazonNotificationService';

async function main() {
  const notificationId = String(process.argv[2] || '').trim();
  const tenantId = String(process.argv[3] || process.env.AGENT10_REPLAY_TENANT_ID || '').trim();
  const dryRun = String(process.argv[4] || process.env.AGENT10_REPLAY_DRY_RUN || 'true').trim().toLowerCase() === 'true';

  if (!notificationId || !tenantId) {
    throw new Error('Usage: ts-node scripts/replay-amazon-notification.ts <notificationId> <tenantId> [dryRun]');
  }

  const result = await amazonNotificationService.replayStoredNotification(notificationId, tenantId, { dryRun });
  logger.info('[AGENT10 REPLAY] Replay completed', {
    notificationId,
    tenantId,
    dryRun,
    result
  });
}

main().catch((error: any) => {
  logger.error('[AGENT10 REPLAY] Replay failed', {
    error: error?.message || error
  });
  process.exit(1);
});
