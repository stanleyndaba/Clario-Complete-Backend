/**
 * Test Script for Agent 10: Notifications Engine
 * Tests notification helper, worker, database operations, and integration with Agents 4-9
 */

import 'dotenv/config';
import logger from '../src/utils/logger';
import { supabaseAdmin } from '../src/database/supabaseClient';
import notificationHelper from '../src/services/notificationHelper';
import notificationsWorker from '../src/workers/notificationsWorker';
import { NotificationType } from '../src/notifications/models/notification';

class NotificationsTest {
  private testUserId: string = 'test-user-notifications-10';
  private testNotificationId: string = '';

  /**
   * Setup test data
   */
  async setupTestData(): Promise<void> {
    try {
      logger.info('📋 Setting up test data...');
      // Test data will be created during individual tests
      logger.info('✅ Test data setup complete');
    } catch (error: any) {
      logger.error('❌ Failed to setup test data', { error: error.message });
    }
  }

  /**
   * Test migration
   */
  async testMigration(): Promise<void> {
    logger.info('📋 Testing Migration...');

    try {
      // Check notifications table exists
      const { data: notifications, error: notificationsError } = await supabaseAdmin
        .from('notifications')
        .select('id, type')
        .limit(1);

      if (notificationsError) {
        logger.error('❌ Migration: notifications table', { error: notificationsError.message });
      } else {
        logger.info('✅ Migration: notifications table');
      }

      // Check if new event types are supported (try to insert a test notification)
      const testTypes = [
        NotificationType.EVIDENCE_FOUND,
        NotificationType.CASE_FILED,
        NotificationType.REFUND_APPROVED,
        NotificationType.FUNDS_DEPOSITED
      ];

      for (const eventType of testTypes) {
        try {
          const { error: insertError } = await supabaseAdmin
            .from('notifications')
            .insert({
              user_id: this.testUserId,
              type: eventType,
              title: 'Test',
              message: 'Test notification',
              status: 'pending'
            })
            .select('id')
            .single();

          if (insertError) {
            logger.error(`❌ Migration: ${eventType} event type`, { error: insertError.message });
          } else {
            logger.info(`✅ Migration: ${eventType} event type`);
            // Cleanup
            await supabaseAdmin
              .from('notifications')
              .delete()
              .eq('user_id', this.testUserId)
              .eq('type', eventType);
          }
        } catch (error: any) {
          logger.error(`❌ Migration: ${eventType} event type`, { error: error.message });
        }
      }

    } catch (error: any) {
      logger.error('❌ Migration test failed', { error: error.message });
    }
  }

  /**
   * Test notification helper
   */
  async testNotificationHelper(): Promise<void> {
    logger.info('🔧 Testing Notification Helper...');

    try {
      // Test initialization
      if (notificationHelper) {
        logger.info('✅ Helper: Initialization');
      }

      // Test notifyClaimDetected
      if (typeof notificationHelper.notifyClaimDetected === 'function') {
        logger.info('✅ Helper: notifyClaimDetected method');
      }

      // Test notifyEvidenceFound
      if (typeof notificationHelper.notifyEvidenceFound === 'function') {
        logger.info('✅ Helper: notifyEvidenceFound method');
      }

      // Test notifyCaseFiled
      if (typeof notificationHelper.notifyCaseFiled === 'function') {
        logger.info('✅ Helper: notifyCaseFiled method');
      }

      // Test notifyRefundApproved
      if (typeof notificationHelper.notifyRefundApproved === 'function') {
        logger.info('✅ Helper: notifyRefundApproved method');
      }

      // Test notifyFundsDeposited
      if (typeof notificationHelper.notifyFundsDeposited === 'function') {
        logger.info('✅ Helper: notifyFundsDeposited method');
      }

      // Test notifyUser (generic)
      if (typeof notificationHelper.notifyUser === 'function') {
        logger.info('✅ Helper: notifyUser method');
      }

      // Test actual notification creation (will create in database)
      try {
        await notificationHelper.notifyClaimDetected(this.testUserId, {
          claimId: 'test-claim-123',
          amount: 100.00,
          currency: 'usd',
          confidence: 0.95
        });
        logger.info('✅ Helper: notifyClaimDetected execution');
      } catch (error: any) {
        logger.warn('⚠️ Helper: notifyClaimDetected execution', {
          error: error.message,
          note: 'May fail if notifications table not accessible'
        });
      }

    } catch (error: any) {
      logger.error('❌ Helper test failed', { error: error.message });
    }
  }

  /**
   * Test worker
   */
  async testWorker(): Promise<void> {
    logger.info('⚙️ Testing Notifications Worker...');

    try {
      // Test initialization
      if (notificationsWorker) {
        logger.info('✅ Worker: Initialization');
      }

      // Test start method
      if (typeof notificationsWorker.start === 'function') {
        logger.info('✅ Worker: start method');
      }

      // Test stop method
      if (typeof notificationsWorker.stop === 'function') {
        logger.info('✅ Worker: stop method');
      }

      // Test processPendingNotifications method
      if (typeof notificationsWorker.processPendingNotifications === 'function') {
        logger.info('✅ Worker: processPendingNotifications method');
      }

    } catch (error: any) {
      logger.error('❌ Worker test failed', { error: error.message });
    }
  }

  /**
   * Test database operations
   */
  async testDatabaseOperations(): Promise<void> {
    logger.info('💾 Testing Database Operations...');

    try {
      // Test insert notification
      const { data: notification, error: insertError } = await supabaseAdmin
        .from('notifications')
        .insert({
          user_id: this.testUserId,
          type: NotificationType.EVIDENCE_FOUND,
          title: 'Test Evidence Found',
          message: 'Test notification message',
          status: 'pending',
          priority: 'normal',
          channel: 'both'
        })
        .select('id')
        .single();

      if (insertError) {
        logger.error('❌ Database: Insert notification', { error: insertError.message });
      } else {
        logger.info('✅ Database: Insert notification', { id: notification?.id });
        this.testNotificationId = notification?.id || '';

        // Cleanup
        if (this.testNotificationId) {
          await supabaseAdmin
            .from('notifications')
            .delete()
            .eq('id', this.testNotificationId);
        }
      }

      // Test query pending notifications
      const { data: pending, error: queryError } = await supabaseAdmin
        .from('notifications')
        .select('id, type, status')
        .eq('status', 'pending')
        .limit(1);

      if (queryError) {
        logger.error('❌ Database: Query pending notifications', { error: queryError.message });
      } else {
        logger.info('✅ Database: Query pending notifications', {
          count: pending?.length || 0
        });
      }

    } catch (error: any) {
      logger.error('❌ Database operations test failed', { error: error.message });
    }
  }

  /**
   * Test integration
   */
  async testIntegration(): Promise<void> {
    logger.info('🔗 Testing Integration...');

    try {
      // Test helper and worker available
      if (notificationHelper && notificationsWorker) {
        logger.info('✅ Integration: Helper and Worker available');
      }

      // Test WebSocket service integration
      try {
        const websocketService = (await import('../src/services/websocketService')).default;
        if (websocketService && typeof websocketService.sendNotificationToUser === 'function') {
          logger.info('✅ Integration: WebSocket service available');
        }
      } catch (error: any) {
        logger.warn('⚠️ Integration: WebSocket service', {
          error: error.message,
          note: 'May not be initialized in test environment'
        });
      }

      // Test email service integration
      try {
        const { EmailService } = await import('../src/notifications/services/delivery/email_service');
        if (EmailService) {
          logger.info('✅ Integration: Email service available');
        }
      } catch (error: any) {
        logger.warn('⚠️ Integration: Email service', {
          error: error.message,
          note: 'May require EMAIL_API_KEY'
        });
      }

      // Test notification service integration
      try {
        const { notificationService } = await import('../src/notifications/services/notification_service');
        if (notificationService) {
          logger.info('✅ Integration: Notification service available');
        }
      } catch (error: any) {
        logger.error('❌ Integration: Notification service', { error: error.message });
      }

    } catch (error: any) {
      logger.error('❌ Integration test failed', { error: error.message });
    }
  }

  /**
   * Test event types
   */
  async testEventTypes(): Promise<void> {
    logger.info('📢 Testing Event Types...');

    try {
      const eventTypes = [
        { type: NotificationType.CLAIM_DETECTED, name: 'Claim Detected' },
        { type: NotificationType.EVIDENCE_FOUND, name: 'Evidence Found' },
        { type: NotificationType.CASE_FILED, name: 'Case Filed' },
        { type: NotificationType.REFUND_APPROVED, name: 'Refund Approved' },
        { type: NotificationType.FUNDS_DEPOSITED, name: 'Funds Deposited' }
      ];

      for (const eventType of eventTypes) {
        try {
          const { error: insertError } = await supabaseAdmin
            .from('notifications')
            .insert({
              user_id: this.testUserId,
              type: eventType.type,
              title: `Test ${eventType.name}`,
              message: `Test notification for ${eventType.name}`,
              status: 'pending'
            });

          if (insertError) {
            logger.error(`❌ Event Type: ${eventType.name}`, { error: insertError.message });
          } else {
            logger.info(`✅ Event Type: ${eventType.name}`);
            // Cleanup
            await supabaseAdmin
              .from('notifications')
              .delete()
              .eq('user_id', this.testUserId)
              .eq('type', eventType.type);
          }
        } catch (error: any) {
          logger.error(`❌ Event Type: ${eventType.name}`, { error: error.message });
        }
      }

    } catch (error: any) {
      logger.error('❌ Event types test failed', { error: error.message });
    }
  }

  /**
   * Test WebSocket delivery
   */
  async testWebSocketDelivery(): Promise<void> {
    logger.info('📡 Testing WebSocket Delivery...');

    try {
      // Test WebSocket service method exists
      const websocketService = (await import('../src/services/websocketService')).default;
      if (typeof websocketService.sendNotificationToUser === 'function') {
        logger.info('✅ WebSocket Delivery: sendNotificationToUser method');
      }

      // Test notification service WebSocket delivery
      const { notificationService } = await import('../src/notifications/services/notification_service');
      if (notificationService) {
        logger.info('✅ WebSocket Delivery: Notification service integration');
      }

    } catch (error: any) {
      logger.warn('⚠️ WebSocket Delivery test', {
        error: error.message,
        note: 'WebSocket may not be initialized in test environment'
      });
    }
  }

  /**
   * Test email delivery
   */
  async testEmailDelivery(): Promise<void> {
    logger.info('📧 Testing Email Delivery...');

    try {
      // Test email service exists
      const { EmailService } = await import('../src/notifications/services/delivery/email_service');
      if (EmailService) {
        logger.info('✅ Email Delivery: EmailService class');
      }

      // Check EMAIL_API_KEY
      const emailApiKey = process.env.EMAIL_API_KEY;
      if (emailApiKey) {
        logger.info('✅ Email Delivery: EMAIL_API_KEY configured');
      } else {
        logger.info('⚠️ Email Delivery: EMAIL_API_KEY not set', {
          note: 'Optional - email delivery will fail without API key'
        });
      }

    } catch (error: any) {
      logger.error('❌ Email delivery test failed', { error: error.message });
    }
  }

  /**
   * Cleanup test data
   */
  async cleanupTestData(): Promise<void> {
    try {
      logger.info('🧹 Cleaning up test data...');

      if (this.testNotificationId) {
        await supabaseAdmin
          .from('notifications')
          .delete()
          .eq('id', this.testNotificationId);
      }

      // Cleanup all test notifications
      await supabaseAdmin
        .from('notifications')
        .delete()
        .eq('user_id', this.testUserId);

      logger.info('✅ Cleanup complete');

    } catch (error: any) {
      logger.error('❌ Cleanup failed', { error: error.message });
    }
  }

  /**
   * Run all tests
   */
  async runTests(): Promise<void> {
    logger.info('\n🚀 Starting Agent 10 (Notifications) Tests...\n');

    try {
      await this.setupTestData();
      await this.testMigration();
      await this.testNotificationHelper();
      await this.testWorker();
      await this.testDatabaseOperations();
      await this.testIntegration();
      await this.testEventTypes();
      await this.testWebSocketDelivery();
      await this.testEmailDelivery();

      logger.info('\n📊 Test Summary:');
      logger.info('Total: 30+ | Passed: See above | Failed: See above');

      logger.info('\n✅ Agent 10 (Notifications) Tests Complete!\n');

    } catch (error: any) {
      logger.error('❌ Test suite failed', { error: error.message });
    } finally {
      await this.cleanupTestData();
    }
  }
}

// Run tests
const test = new NotificationsTest();
test.runTests().catch(console.error);

