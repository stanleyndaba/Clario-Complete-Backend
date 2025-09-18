import { getLogger } from '../../utils/logger';
import { Notification, UserNotificationPreference } from '../models/notification.model';
import { notificationQueue, QueueMessage } from '../utils/queue';
import emailService from './email.service';
import pushService from './push.service';
import inAppService from './inapp.service';
import { getDatabase } from '../../db/connection';

const logger = getLogger('NotificationService');

export interface NotificationEvent {
  type: string;
  userId: string;
  data: Record<string, any>;
  channels?: ('email' | 'push' | 'inapp' | 'slack')[];
  priority?: number;
  scheduledAt?: Date;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  channels: ('email' | 'push' | 'inapp' | 'slack')[];
  subject?: string;
  title?: string;
  message?: string;
  html?: string;
  text?: string;
}

class NotificationService {
  private templates: Map<string, NotificationTemplate> = new Map();

  constructor() {
    this.initializeTemplates();
  }

  private initializeTemplates(): void {
    // Initialize default templates
    const defaultTemplates: NotificationTemplate[] = [
      {
        id: 'low_stock_alert',
        name: 'Low Stock Alert',
        channels: ['email', 'inapp'],
        subject: 'Low Stock Alert - {{productName}}',
        title: '🚨 Low Stock Alert',
        message: 'Your product {{productName}} (SKU: {{sku}}) is running low on stock.',
      },
      {
        id: 'fba_report_ready',
        name: 'FBA Report Ready',
        channels: ['inapp', 'email'],
        title: '📊 FBA Report Ready',
        message: 'Your FBA report for {{reportType}} is now ready for review.',
      },
      {
        id: 'dispute_approved',
        name: 'Dispute Approved',
        channels: ['email', 'inapp', 'push'],
        subject: 'Dispute Approved - {{disputeId}}',
        title: '✅ Dispute Approved',
        message: 'Your dispute {{disputeId}} has been approved for {{amount}}.',
      },
      {
        id: 'sync_completed',
        name: 'Sync Completed',
        channels: ['inapp'],
        title: '🔄 Sync Completed',
        message: 'Data sync completed successfully. {{recordCount}} records processed.',
      },
    ];

    defaultTemplates.forEach(template => {
      this.templates.set(template.id, template);
    });
  }

  async processEvent(event: NotificationEvent): Promise<void> {
    try {
      logger.info(`Processing notification event: ${event.type} for user ${event.userId}`);

      // Get user preferences
      const userPreferences = await this.getUserPreferences(event.userId, event.type);

      // Determine which channels to use
      const channels = event.channels || this.getDefaultChannels(event.type);
      const enabledChannels = channels.filter(channel => 
        userPreferences.some(pref => pref.channel === channel && pref.enabled)
      );

      if (enabledChannels.length === 0) {
        logger.info(`No enabled channels for user ${event.userId} and event ${event.type}`);
        return;
      }

      // Create notification records and queue messages
      const promises = enabledChannels.map(channel => 
        this.createNotification(event, channel)
      );

      await Promise.all(promises);
      logger.info(`Processed notification event ${event.type} for user ${event.userId} on ${enabledChannels.length} channels`);
    } catch (error) {
      logger.error(`Failed to process notification event ${event.type}:`, error);
      throw error;
    }
  }

  private async getUserPreferences(userId: string, type: string): Promise<UserNotificationPreference[]> {
    try {
      const preferences = await UserNotificationPreference.findByUserIdAndType(userId, type);
      
      // If no preferences found, create default ones
      if (preferences.length === 0) {
        const defaultChannels = this.getDefaultChannels(type);
        const defaultPreferences = defaultChannels.map(channel => 
          UserNotificationPreference.create({
            userId,
            channel,
            type,
            enabled: true,
          })
        );
        return Promise.all(defaultPreferences);
      }

      return preferences;
    } catch (error) {
      logger.error(`Failed to get user preferences for ${userId}:`, error);
      return [];
    }
  }

  private getDefaultChannels(type: string): ('email' | 'push' | 'inapp' | 'slack')[] {
    const template = this.templates.get(type);
    return template?.channels || ['inapp'];
  }

  private async createNotification(event: NotificationEvent, channel: 'email' | 'push' | 'inapp' | 'slack'): Promise<void> {
    try {
      // Create notification record
      const notification = await Notification.create({
        userId: event.userId,
        type: event.type,
        channel,
        templateId: event.type,
        payload: event.data,
        status: 'pending',
      });

      // Queue the notification for processing
      const queueMessage: QueueMessage = {
        id: notification.id,
        type: event.type,
        userId: event.userId,
        channel,
        templateId: event.type,
        payload: event.data,
        priority: event.priority || 0,
        scheduledAt: event.scheduledAt,
      };

      await notificationQueue.publish(queueMessage);
      logger.info(`Queued notification ${notification.id} for channel ${channel}`);
    } catch (error) {
      logger.error(`Failed to create notification for channel ${channel}:`, error);
      throw error;
    }
  }

  async processQueuedNotification(message: QueueMessage): Promise<void> {
    try {
      logger.info(`Processing queued notification ${message.id} for channel ${message.channel}`);

      const notification = await Notification.findById(message.id);
      if (!notification) {
        logger.error(`Notification ${message.id} not found`);
        return;
      }

      let success = false;

      switch (message.channel) {
        case 'email':
          success = await this.sendEmailNotification(notification, message);
          break;
        case 'push':
          success = await this.sendPushNotification(notification, message);
          break;
        case 'inapp':
          success = await this.sendInAppNotification(notification, message);
          break;
        case 'slack':
          success = await this.sendSlackNotification(notification, message);
          break;
        default:
          logger.error(`Unsupported channel: ${message.channel}`);
          return;
      }

      if (success) {
        await notification.markAsSent();
        logger.info(`Successfully sent notification ${message.id} via ${message.channel}`);
      } else {
        await notification.markAsFailed('Failed to send notification');
        logger.error(`Failed to send notification ${message.id} via ${message.channel}`);
      }
    } catch (error) {
      logger.error(`Failed to process queued notification ${message.id}:`, error);
      
      // Mark as failed
      const notification = await Notification.findById(message.id);
      if (notification) {
        await notification.markAsFailed(error.message);
      }
    }
  }

  private async sendEmailNotification(notification: Notification, message: QueueMessage): Promise<boolean> {
    try {
      const template = this.templates.get(message.templateId);
      if (!template) {
        logger.error(`Template ${message.templateId} not found`);
        return false;
      }

      // Get user email
      const user = await this.getUser(notification.userId);
      if (!user) {
        logger.error(`User ${notification.userId} not found`);
        return false;
      }

      return await emailService.sendTemplatedEmail(
        user.email,
        message.templateId,
        message.payload,
        template.subject
      );
    } catch (error) {
      logger.error(`Failed to send email notification:`, error);
      return false;
    }
  }

  private async sendPushNotification(notification: Notification, message: QueueMessage): Promise<boolean> {
    try {
      const template = this.templates.get(message.templateId);
      if (!template) {
        logger.error(`Template ${message.templateId} not found`);
        return false;
      }

      const pushNotification = {
        title: this.replacePlaceholders(template.title || '', message.payload),
        body: this.replacePlaceholders(template.message || '', message.payload),
        data: message.payload,
        priority: 'normal' as const,
      };

      return await pushService.sendToUser(notification.userId, pushNotification);
    } catch (error) {
      logger.error(`Failed to send push notification:`, error);
      return false;
    }
  }

  private async sendInAppNotification(notification: Notification, message: QueueMessage): Promise<boolean> {
    try {
      return await inAppService.sendNotification(
        notification.userId,
        message.templateId,
        message.payload
      );
    } catch (error) {
      logger.error(`Failed to send in-app notification:`, error);
      return false;
    }
  }

  private async sendSlackNotification(notification: Notification, message: QueueMessage): Promise<boolean> {
    // TODO: Implement Slack integration
    logger.warn('Slack notifications not yet implemented');
    return false;
  }

  private async getUser(userId: string): Promise<any> {
    const db = getDatabase();
    return await db('users').where({ id: userId }).first();
  }

  private replacePlaceholders(template: string, data: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), String(value));
    }
    return result;
  }

  async getNotificationHistory(userId: string, limit: number = 50, offset: number = 0): Promise<Notification[]> {
    return await Notification.findByUserId(userId, limit, offset);
  }

  async updateUserPreferences(userId: string, preferences: Array<{
    channel: 'email' | 'push' | 'inapp' | 'slack';
    type: string;
    enabled: boolean;
  }>): Promise<void> {
    const db = getDatabase();
    
    for (const preference of preferences) {
      await db('user_notification_preferences')
        .where({ userId, channel: preference.channel, type: preference.type })
        .update({ enabled: preference.enabled, updatedAt: new Date() });
    }

    logger.info(`Updated notification preferences for user ${userId}`);
  }

  async getNotificationStats(userId: string): Promise<{
    total: number;
    sent: number;
    failed: number;
    pending: number;
    byChannel: Record<string, number>;
  }> {
    const db = getDatabase();
    
    const [total, sent, failed, pending] = await Promise.all([
      db('notifications').where({ userId }).count('* as count').first(),
      db('notifications').where({ userId, status: 'sent' }).count('* as count').first(),
      db('notifications').where({ userId, status: 'failed' }).count('* as count').first(),
      db('notifications').where({ userId, status: 'pending' }).count('* as count').first(),
    ]);

    const byChannel = await db('notifications')
      .where({ userId })
      .select('channel')
      .count('* as count')
      .groupBy('channel');

    const channelStats: Record<string, number> = {};
    byChannel.forEach((item: any) => {
      channelStats[item.channel] = parseInt(item.count);
    });

    return {
      total: parseInt(total?.count || '0'),
      sent: parseInt(sent?.count || '0'),
      failed: parseInt(failed?.count || '0'),
      pending: parseInt(pending?.count || '0'),
      byChannel: channelStats,
    };
  }

  // Event listeners for platform events
  async onFbaReportReady(userId: string, reportId: string, reportType: string): Promise<void> {
    await this.processEvent({
      type: 'fba_report_ready',
      userId,
      data: { reportId, reportType, generatedAt: new Date().toISOString() },
    });
  }

  async onLowStockAlert(userId: string, productName: string, sku: string, currentStock: number): Promise<void> {
    await this.processEvent({
      type: 'low_stock_alert',
      userId,
      data: { productName, sku, currentStock, lastUpdated: new Date().toISOString() },
    });
  }

  async onDisputeApproved(userId: string, disputeId: string, amount: number): Promise<void> {
    await this.processEvent({
      type: 'dispute_approved',
      userId,
      data: { disputeId, amount, approvedAt: new Date().toISOString() },
    });
  }

  async onSyncCompleted(userId: string, recordCount: number): Promise<void> {
    await this.processEvent({
      type: 'sync_completed',
      userId,
      data: { recordCount, completedAt: new Date().toISOString() },
    });
  }
}

export const notificationService = new NotificationService();
export default notificationService; 