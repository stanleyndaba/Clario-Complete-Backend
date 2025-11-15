/**
 * Notifications Worker
 * Automated background worker for processing queued notifications
 * Runs every 1-2 minutes, processes pending notifications, and delivers via WebSocket + Email
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';
import { notificationService } from '../notifications/services/notification_service';
import Notification, { NotificationStatus } from '../notifications/models/notification';

export interface NotificationStats {
  processed: number;
  delivered: number;
  failed: number;
  retried: number;
  errors: string[];
}

class NotificationsWorker {
  private schedule: string = '*/2 * * * *'; // Every 2 minutes
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private maxRetries: number = 3;

  /**
   * Start the worker
   */
  start(): void {
    if (this.cronJob) {
      logger.warn('⚠️ [NOTIFICATIONS] Worker already started');
      return;
    }

    logger.info('🚀 [NOTIFICATIONS] Starting Notifications Worker', {
      schedule: this.schedule
    });

    // Schedule notification processing job (every 2 minutes)
    this.cronJob = cron.schedule(this.schedule, async () => {
      if (this.isRunning) {
        logger.debug('⏸️ [NOTIFICATIONS] Previous run still in progress, skipping');
        return;
      }

      this.isRunning = true;
      try {
        await this.processPendingNotifications();
      } catch (error: any) {
        logger.error('❌ [NOTIFICATIONS] Error in notification job', { error: error.message });
      } finally {
        this.isRunning = false;
      }
    });

    logger.info('✅ [NOTIFICATIONS] Worker started successfully');
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    logger.info('🛑 [NOTIFICATIONS] Worker stopped');
  }

  /**
   * Process pending notifications
   */
  async processPendingNotifications(): Promise<NotificationStats> {
    const stats: NotificationStats = {
      processed: 0,
      delivered: 0,
      failed: 0,
      retried: 0,
      errors: []
    };

    try {
      logger.info('📬 [NOTIFICATIONS] Starting notification processing run');

      // Get pending notifications
      const { data: pendingNotifications, error } = await supabaseAdmin
        .from('notifications')
        .select('*')
        .eq('status', NotificationStatus.PENDING)
        .order('created_at', { ascending: true })
        .limit(50); // Process up to 50 notifications per run

      if (error) {
        logger.error('❌ [NOTIFICATIONS] Failed to get pending notifications', { error: error.message });
        stats.errors.push(`Failed to get notifications: ${error.message}`);
        return stats;
      }

      if (!pendingNotifications || pendingNotifications.length === 0) {
        logger.debug('ℹ️ [NOTIFICATIONS] No pending notifications to process');
        return stats;
      }

      logger.info(`📋 [NOTIFICATIONS] Found ${pendingNotifications.length} pending notifications`);

      // Process each notification
      for (const notificationData of pendingNotifications) {
        try {
          stats.processed++;

          const notification = new Notification(notificationData);

          // Skip expired notifications
          if (notification.isExpired()) {
            await notification.update({ status: NotificationStatus.EXPIRED });
            logger.debug('⏭️ [NOTIFICATIONS] Notification expired, skipping', {
              id: notification.id
            });
            continue;
          }

          // Deliver notification
          const delivered = await this.deliverNotification(notification);

          if (delivered) {
            stats.delivered++;
            logger.info('✅ [NOTIFICATIONS] Notification delivered', {
              id: notification.id,
              type: notification.type,
              userId: notification.user_id
            });
          } else {
            stats.failed++;
            stats.errors.push(`Notification ${notification.id}: Delivery failed`);

            // Check retry count
            const retryCount = (notification.payload?.retryCount as number) || 0;
            if (retryCount < this.maxRetries) {
              stats.retried++;
              // Update retry count and keep as pending for retry
              await notification.update({
                payload: {
                  ...notification.payload,
                  retryCount: retryCount + 1,
                  lastRetryAt: new Date().toISOString()
                }
              });
              logger.warn('🔄 [NOTIFICATIONS] Notification will be retried', {
                id: notification.id,
                retryCount: retryCount + 1
              });
            } else {
              // Max retries exceeded, mark as failed
              await notification.markAsFailed();
              logger.error('❌ [NOTIFICATIONS] Notification failed after max retries', {
                id: notification.id,
                maxRetries: this.maxRetries
              });
            }
          }

          // Small delay between notifications
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error: any) {
          logger.error('❌ [NOTIFICATIONS] Error processing notification', {
            notificationId: notificationData.id,
            error: error.message
          });
          stats.failed++;
          stats.errors.push(`Notification ${notificationData.id}: ${error.message}`);
        }
      }

      logger.info('✅ [NOTIFICATIONS] Notification processing run completed', stats);
      return stats;

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Fatal error in notification processing', { error: error.message });
      stats.errors.push(`Fatal error: ${error.message}`);
      return stats;
    }
  }

  /**
   * Deliver a notification via WebSocket and Email
   */
  private async deliverNotification(notification: Notification): Promise<boolean> {
    try {
      logger.debug('📤 [NOTIFICATIONS] Delivering notification', {
        id: notification.id,
        type: notification.type,
        channel: notification.channel
      });

      const deliveryPromises: Promise<void>[] = [];

      // Deliver via WebSocket if in-app or both
      if (notification.channel === 'in_app' || notification.channel === 'both') {
        deliveryPromises.push(
          this.deliverViaWebSocket(notification)
        );
      }

      // Deliver via email if email or both
      if (notification.channel === 'email' || notification.channel === 'both') {
        deliveryPromises.push(
          this.deliverViaEmail(notification)
        );
      }

      // Wait for all delivery attempts
      const results = await Promise.allSettled(deliveryPromises);

      // Check if at least one delivery succeeded
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const success = successCount > 0;

      if (success) {
        // Mark as delivered
        await notification.markAsDelivered();
        logger.info('✅ [NOTIFICATIONS] Notification delivered successfully', {
          id: notification.id,
          channels: notification.channel
        });
      } else {
        // All deliveries failed
        const errors = results
          .filter(r => r.status === 'rejected')
          .map(r => (r as PromiseRejectedResult).reason?.message || 'Unknown error');
        logger.error('❌ [NOTIFICATIONS] All delivery channels failed', {
          id: notification.id,
          errors
        });
      }

      return success;

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Failed to deliver notification', {
        id: notification.id,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Deliver notification via WebSocket
   */
  private async deliverViaWebSocket(notification: Notification): Promise<void> {
    try {
      const websocketService = (await import('../services/websocketService')).default;

      websocketService.sendNotificationToUser(notification.user_id, {
        type: this.getNotificationType(notification.priority),
        title: notification.title,
        message: notification.message,
        data: notification.payload
      });

      logger.debug('📡 [NOTIFICATIONS] Notification sent via WebSocket', {
        id: notification.id,
        userId: notification.user_id
      });

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] WebSocket delivery failed', {
        id: notification.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Deliver notification via Email
   */
  private async deliverViaEmail(notification: Notification): Promise<void> {
    try {
      // Use notification service's email delivery
      await notificationService.createNotification({
        type: notification.type as any,
        user_id: notification.user_id,
        title: notification.title,
        message: notification.message,
        priority: notification.priority as any,
        channel: 'email' as any,
        payload: notification.payload,
        immediate: true
      });

      logger.debug('📧 [NOTIFICATIONS] Notification sent via Email', {
        id: notification.id,
        userId: notification.user_id
      });

    } catch (error: any) {
      logger.error('❌ [NOTIFICATIONS] Email delivery failed', {
        id: notification.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get notification type for WebSocket
   */
  private getNotificationType(priority: string): 'info' | 'success' | 'warning' | 'error' {
    switch (priority) {
      case 'urgent':
      case 'high':
        return 'success';
      case 'normal':
        return 'info';
      case 'low':
        return 'info';
      default:
        return 'info';
    }
  }
}

// Export singleton instance
const notificationsWorker = new NotificationsWorker();
export default notificationsWorker;

