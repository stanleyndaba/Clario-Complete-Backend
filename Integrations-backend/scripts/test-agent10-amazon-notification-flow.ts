import 'dotenv/config';
import logger from '../src/utils/logger';
import { supabaseAdmin } from '../src/database/supabaseClient';
import amazonNotificationService from '../src/services/amazonNotificationService';
import { syncJobManager } from '../src/services/syncJobManager';

async function main() {
  const originalStartSync = syncJobManager.startSync.bind(syncJobManager);
  let triggerCalls: Array<{ userId: string; storeId?: string }> = [];
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const storeId = '33333333-3333-3333-3333-333333333333';
  const sellerId = process.env.AGENT10_TEST_SELLER_ID || 'TEST-SELLER-ID';
  const marketplaceId = 'ATVPDKIKX0DER';
  const subscriptionId = process.env.AGENT10_TEST_SUBSCRIPTION_ID || `sub_${Date.now()}`;

  try {
    (syncJobManager as any).startSync = async (userId: string, storeId?: string) => {
      triggerCalls.push({ userId, storeId });
      return {
        syncId: `agent10_test_sync_${Date.now()}`,
        status: 'in_progress'
      };
    };

    await supabaseAdmin.from('stores').insert({
      id: storeId,
      tenant_id: tenantId,
      name: 'Agent 10 Test Store',
      marketplace: marketplaceId,
      seller_id: sellerId,
      is_active: true
    });

    await supabaseAdmin.from('tokens').insert({
      id: '44444444-4444-4444-4444-444444444444',
      user_id: userId,
      provider: 'amazon',
      tenant_id: tenantId,
      store_id: storeId,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    });

    const envelope = {
      Type: 'Notification',
      MessageId: `msg_${Date.now()}`,
      TopicArn: process.env.AMAZON_NOTIFICATION_ALLOWED_TOPIC_ARNS || 'arn:aws:sns:us-east-1:123456789012:test-topic',
      Message: JSON.stringify({
        NotificationType: 'REPORT_PROCESSING_FINISHED',
        ReportType: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
        NotificationMetadata: {
          NotificationId: `amz_${Date.now()}`,
          SubscriptionId: subscriptionId
        },
        Payload: {
          SellerId: sellerId,
          MarketplaceId: marketplaceId
        }
      })
    };

    const first = await amazonNotificationService.receiveTrustedEnvelopeForTest(envelope);
    const second = await amazonNotificationService.receiveTrustedEnvelopeForTest(envelope);
    const storedNotifications = await amazonNotificationService.listNotifications(tenantId, { limit: 10 });

    logger.info('[AGENT10 HARNESS] Notification flow results', {
      first,
      second,
      triggerCalls,
      storedNotifications
    });
  } finally {
    (syncJobManager as any).startSync = originalStartSync;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: any) => {
    logger.error('[AGENT10 HARNESS] Flow test failed', {
      error: error?.message || error
    });
    process.exit(1);
  });
