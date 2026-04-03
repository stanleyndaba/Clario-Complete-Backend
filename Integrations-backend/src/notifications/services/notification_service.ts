import { getLogger } from '../../utils/logger';
import Notification, {
  UpdateNotificationRequest,
  NotificationFilters,
  NotificationType,
  NotificationStatus,
  NotificationPriority,
  NotificationChannel
} from '../models/notification';
import { EmailService } from './delivery/email_service';
import websocketService from '../../services/websocketService';
import sseHub from '../../utils/sseHub';
import { supabaseAdmin } from '../../database/supabaseClient';
import { normalizeAgent10EventPayload } from '../../utils/agent10Event';
import { DEFAULT_NOTIFICATION_PREFERENCES, normalizeNotificationPreferences } from '../preferencesConfig';

const logger = getLogger('NotificationService');

export interface NotificationEvent {
  type: NotificationType;
  user_id: string;
  tenant_id?: string;
  title: string;
  message: string;
  priority?: NotificationPriority;
  channel?: NotificationChannel;
  payload?: Record<string, any>;
  expires_at?: Date;
  immediate?: boolean;
}

export interface NotificationStats {
  total: number;
  unread: number;
  read: number;
  pending: number;
  failed: number;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
}

export class NotificationService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  /**
   * Initialize the notification service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Notification service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize notification service:', error);
      throw error;
    }
  }

  /**
   * Send a direct email through the email service
   */
  async sendEmail(emailData: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<void> {
    await this.emailService.sendEmail(emailData);
  }

  /**
   * Create and immediately deliver a notification.
   */
  async createNotification(event: NotificationEvent): Promise<Notification | null> {
    try {
      logger.info('Creating notification', {
        type: event.type,
        user_id: event.user_id,
        immediate: event.immediate
      });

      const effectiveChannel = await this.resolveEffectiveChannel(
        event.user_id,
        event.tenant_id,
        event.type,
        event.channel || NotificationChannel.IN_APP
      );

      if (!effectiveChannel) {
        logger.info('Notification suppressed by user preference', {
          type: event.type,
          user_id: event.user_id
        });
        return null;
      }

      const normalizedPayload = normalizeAgent10EventPayload(event.type, event.payload, {
        tenantId: event.tenant_id
      });
      const dedupeKey = this.buildDedupeKey(event, normalizedPayload);

      if (dedupeKey) {
        const existing = await Notification.findByDedupeKey(event.user_id, event.tenant_id!, dedupeKey);
        if (existing) {
          logger.info('Notification deduped', {
            id: existing.id,
            dedupeKey,
            type: event.type,
            user_id: event.user_id
          });
          return existing;
        }
      }

      // Create the notification in the database
      const notification = await Notification.create({
        user_id: event.user_id,
        tenant_id: event.tenant_id,
        type: event.type,
        title: event.title,
        message: event.message,
        priority: event.priority,
        channel: effectiveChannel,
        payload: {
          ...normalizedPayload,
          preference_toggle_id: event.type,
          dedupe_key: dedupeKey || null
        },
        dedupe_key: dedupeKey,
        expires_at: event.expires_at
      });

      // Immediate delivery is the single authoritative execution path.
      await this.deliverNotification(notification);

      logger.info('Notification created and delivered through authoritative path', {
        id: notification.id,
        channel: notification.channel
      });
      return notification;
    } catch (error) {
      logger.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create multiple notifications in batch
   */
  async createBatchNotifications(events: NotificationEvent[]): Promise<Notification[]> {
    try {
      logger.info('Creating batch notifications', { count: events.length });

      const notifications: Notification[] = [];
      const promises = events.map(event => this.createNotification(event));

      for (const promise of promises) {
        try {
          const notification = await promise;
          if (notification) {
            notifications.push(notification);
          }
        } catch (error) {
          logger.error('Error creating notification in batch:', error);
          // Continue with other notifications
        }
      }

      logger.info('Batch notifications created successfully', {
        total: events.length,
        successful: notifications.length
      });

      return notifications;
    } catch (error) {
      logger.error('Error creating batch notifications:', error);
      throw error;
    }
  }

  /**
   * Get notifications with filters
   */
  async getNotifications(filters: NotificationFilters): Promise<Notification[]> {
    try {
      logger.info('Fetching notifications with filters', filters);
      const notifications = await Notification.findMany(filters);
      logger.info('Notifications fetched successfully', { count: notifications.length });
      return notifications;
    } catch (error) {
      logger.error('Error fetching notifications:', error);
      throw error;
    }
  }

  /**
   * Get notification by ID
   */
  async getNotificationById(id: string): Promise<Notification | null> {
    try {
      logger.info('Fetching notification by ID', { id });
      const notification = await Notification.findById(id);
      return notification;
    } catch (error) {
      logger.error('Error fetching notification by ID:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id: string): Promise<Notification> {
    try {
      logger.info('Marking notification as read', { id });
      const notification = await Notification.findById(id);

      if (!notification) {
        throw new Error('Notification not found');
      }

      const updated = await notification.markAsRead();
      logger.info('Notification marked as read successfully', { id });
      return updated;
    } catch (error) {
      logger.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(ids: string[]): Promise<Notification[]> {
    try {
      logger.info('Marking multiple notifications as read', { count: ids.length });

      const promises = ids.map(id => this.markAsRead(id));
      const results = await Promise.allSettled(promises);

      const successful: Notification[] = [];
      const failed: string[] = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successful.push(result.value);
        } else {
          failed.push(ids[index]);
          logger.error('Failed to mark notification as read:', {
            id: ids[index],
            error: result.reason
          });
        }
      });

      logger.info('Batch mark as read completed', {
        total: ids.length,
        successful: successful.length,
        failed: failed.length
      });

      return successful;
    } catch (error) {
      logger.error('Error marking multiple notifications as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string, tenantId?: string): Promise<number> {
    try {
      logger.info('Marking all notifications as read', { userId });
      const count = await Notification.markAllAsRead(userId, tenantId);
      logger.info('All notifications marked as read successfully', { userId, count });
      return count;
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Update notification
   */
  async updateNotification(id: string, updates: UpdateNotificationRequest): Promise<Notification> {
    try {
      logger.info('Updating notification', { id, updates });
      const notification = await Notification.findById(id);

      if (!notification) {
        throw new Error('Notification not found');
      }

      const updated = await notification.update(updates);
      logger.info('Notification updated successfully', { id });
      return updated;
    } catch (error) {
      logger.error('Error updating notification:', error);
      throw error;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(id: string): Promise<void> {
    try {
      logger.info('Deleting notification', { id });
      const notification = await Notification.findById(id);

      if (!notification) {
        throw new Error('Notification not found');
      }

      await notification.delete();
      logger.info('Notification deleted successfully', { id });
    } catch (error) {
      logger.error('Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * Get notification statistics for a user
   */
  async getNotificationStats(user_id: string, tenant_id?: string): Promise<NotificationStats> {
    try {
      logger.info('Fetching notification stats for user', { user_id });

      const allNotifications = await Notification.findMany({ user_id, tenant_id });

      const stats: NotificationStats = {
        total: allNotifications.length,
        unread: allNotifications.filter(n => n.isUnread()).length,
        read: allNotifications.filter(n => n.status === NotificationStatus.READ).length,
        pending: allNotifications.filter(n => n.status === NotificationStatus.PENDING).length,
        failed: allNotifications.filter(n => n.status === NotificationStatus.FAILED).length,
        by_type: {},
        by_priority: {}
      };

      // Count by type
      allNotifications.forEach(notification => {
        const type = notification.type;
        stats.by_type[type] = (stats.by_type[type] || 0) + 1;
      });

      // Count by priority
      allNotifications.forEach(notification => {
        const priority = notification.priority;
        stats.by_priority[priority] = (stats.by_priority[priority] || 0) + 1;
      });

      logger.info('Notification stats fetched successfully', { user_id, stats });
      return stats;
    } catch (error) {
      logger.error('Error fetching notification stats:', error);
      throw error;
    }
  }

  /**
   * Clean up expired notifications
   */
  async cleanupExpiredNotifications(): Promise<number> {
    try {
      logger.info('Starting cleanup of expired notifications');

      const allNotifications = await Notification.findMany({});
      const expiredNotifications = allNotifications.filter(n => n.isExpired());

      let deletedCount = 0;
      for (const notification of expiredNotifications) {
        try {
          await notification.delete();
          deletedCount++;
        } catch (error) {
          logger.error('Error deleting expired notification:', {
            id: notification.id,
            error
          });
        }
      }

      logger.info('Expired notifications cleanup completed', { deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Error during expired notifications cleanup:', error);
      throw error;
    }
  }

  /**
   * Deliver a notification through appropriate channels
   */
  private async deliverNotification(notification: Notification): Promise<void> {
    try {
      logger.info('Delivering notification', {
        id: notification.id,
        channel: notification.channel
      });

      const effectiveChannel = await this.resolveEffectiveChannel(
        notification.user_id,
        notification.tenant_id,
        notification.type,
        notification.channel
      );

      if (!effectiveChannel) {
        await notification.update({
          status: NotificationStatus.EXPIRED
        });
        logger.info('Notification delivery skipped by user preference', {
          id: notification.id,
          type: notification.type,
          userId: notification.user_id
        });
        return;
      }

      const inAppRequested = effectiveChannel === NotificationChannel.IN_APP || effectiveChannel === NotificationChannel.BOTH;
      const emailRequested = effectiveChannel === NotificationChannel.EMAIL || effectiveChannel === NotificationChannel.BOTH;
      const deliveryState = {
        in_app_requested: inAppRequested,
        email_requested: emailRequested,
        realtime_requested: inAppRequested,
        in_app_success: inAppRequested,
        email_success: false,
        realtime_success: false,
        attempted_at: new Date().toISOString()
      } as Record<string, any>;
      const errors: string[] = [];

      if (inAppRequested) {
        deliveryState.realtime_success = await this.deliverViaWebSocket(notification);
      }

      if (emailRequested) {
        const emailResult = await this.deliverViaEmail(notification);
        deliveryState.email_success = emailResult.success;
        if (emailResult.error) {
          errors.push(emailResult.error);
        }
      }

      const successfulChannels = [
        inAppRequested ? deliveryState.in_app_success : false,
        emailRequested ? deliveryState.email_success : false
      ].filter(Boolean).length;
      const requestedChannels = [inAppRequested, emailRequested].filter(Boolean).length;

      let nextStatus = NotificationStatus.FAILED;
      if (successfulChannels === 0) {
        nextStatus = NotificationStatus.FAILED;
      } else if (successfulChannels === requestedChannels) {
        nextStatus = NotificationStatus.DELIVERED;
      } else {
        nextStatus = NotificationStatus.PARTIAL;
      }

      await notification.update({
        status: nextStatus,
        delivered_at: successfulChannels > 0 ? new Date() : undefined,
        delivery_state: deliveryState,
        last_delivery_error: errors.length ? errors.join(' | ') : null
      });

      logger.info('Notification delivery completed', {
        id: notification.id,
        status: nextStatus,
        deliveryState
      });
    } catch (error) {
      logger.error('Error delivering notification:', error);
      await notification.update({
        status: NotificationStatus.FAILED,
        last_delivery_error: error instanceof Error ? error.message : 'notification_delivery_failed'
      });
      throw error;
    }
  }

  /**
   * Deliver notification via WebSocket and SSE
   */
  private async deliverViaWebSocket(notification: Notification): Promise<boolean> {
    try {
      const tenantSlug = await this.resolveTenantSlug(notification.tenant_id);
      const websocketPayload = {
        type: this.getNotificationType(notification.priority),
        title: notification.title,
        message: notification.message,
        data: notification.payload
      };
      const payload = normalizeAgent10EventPayload('notification', {
        type: notification.type,
        title: notification.title,
        message: notification.message,
        payload: notification.payload,
        data: notification.payload,
        timestamp: notification.created_at,
        id: notification.id,
        status: notification.status,
        priority: notification.priority,
        channel: notification.channel,
        created_at: notification.created_at,
        updated_at: notification.updated_at,
        read: false,
        tenant_id: notification.tenant_id
      }, {
        tenantId: notification.tenant_id
      });

      // Send via Socket.IO
      websocketService.sendNotificationToUser(notification.user_id, websocketPayload);

      // Send via SSE
      sseHub.sendEvent(notification.user_id, 'notification', payload, tenantSlug || undefined);

      logger.debug('Notification sent via Realtime (WebSocket + SSE)', {
        id: notification.id,
        userId: notification.user_id
      });
      return true;

    } catch (error) {
      logger.error('Error sending notification via Realtime:', error);
      return false;
    }
  }

  /**
   * Get notification type for WebSocket
   */
  private getNotificationType(priority: NotificationPriority): 'info' | 'success' | 'warning' | 'error' {
    switch (priority) {
      case NotificationPriority.URGENT:
      case NotificationPriority.HIGH:
        return 'success';
      case NotificationPriority.NORMAL:
        return 'info';
      case NotificationPriority.LOW:
        return 'info';
      default:
        return 'info';
    }
  }

  private buildDedupeKey(
    event: NotificationEvent,
    normalizedPayload: Record<string, any>
  ): string | undefined {
    const explicit = [
      normalizedPayload.dedupe_key,
      normalizedPayload.event_id,
      normalizedPayload.provider_message_id,
      normalizedPayload.amazon_notification_id,
      normalizedPayload.payload?.dedupe_key
    ]
      .map((value) => String(value || '').trim())
      .find(Boolean);

    if (explicit) {
      return explicit;
    }

    const baseParts = [
      event.type,
      event.tenant_id,
      event.user_id,
      normalizedPayload.entity_type,
      normalizedPayload.entity_id
    ].map((value) => String(value || '').trim()).filter(Boolean);

    switch (event.type) {
      case NotificationType.EVIDENCE_FOUND:
        baseParts.push(
          normalizedPayload.matchFound ? 'match_ready' : normalizedPayload.parsed ? 'parsed' : 'ingested'
        );
        break;
      case NotificationType.SYNC_STARTED:
      case NotificationType.SYNC_COMPLETED:
      case NotificationType.SYNC_FAILED:
        if (normalizedPayload.sync_id) {
          baseParts.push(String(normalizedPayload.sync_id));
        }
        break;
      case NotificationType.NEEDS_EVIDENCE:
      case NotificationType.APPROVED:
      case NotificationType.REJECTED:
      case NotificationType.PAID:
        if (normalizedPayload.amazon_case_id) {
          baseParts.push(String(normalizedPayload.amazon_case_id));
        }
        if (normalizedPayload.provider_message_id) {
          baseParts.push(String(normalizedPayload.provider_message_id));
        }
        break;
      default:
        break;
    }

    return baseParts.length >= 4 ? baseParts.join(':') : undefined;
  }

  private async deliverViaEmail(notification: Notification): Promise<{ success: boolean; error?: string }> {
    try {
      await this.emailService.sendNotification(notification);
      return { success: true };
    } catch (error: any) {
      logger.error('Error sending notification via email:', error);
      return {
        success: false,
        error: error?.message || 'email_delivery_failed'
      };
    }
  }

  private async getUserNotificationPreferences(
    userId: string,
    tenantId: string
  ): Promise<Record<string, { email?: boolean; inApp?: boolean }>> {
    const { data, error } = await supabaseAdmin
      .from('user_notification_preferences')
      .select('preferences')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      logger.warn('Failed to load user notification preferences', {
        userId,
        tenantId,
        error: error.message
      });
      return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }

    return normalizeNotificationPreferences((data?.preferences || {}) as Record<string, { email?: boolean; inApp?: boolean }>);
  }

  private async resolveEffectiveChannel(
    userId: string,
    tenantId: string | undefined,
    type: NotificationType,
    requestedChannel: NotificationChannel
  ): Promise<NotificationChannel | null> {
    if (!tenantId) {
      throw new Error('TENANT_REQUIRED');
    }

    const preferences = await this.getUserNotificationPreferences(userId, tenantId);
    const savedPreference = preferences[type] || DEFAULT_NOTIFICATION_PREFERENCES[type];
    if (!savedPreference) {
      throw new Error(`UNMAPPED_NOTIFICATION_TYPE:${type}`);
    }

    const emailAllowed = savedPreference.email !== false;
    const inAppAllowed = savedPreference.inApp !== false;

    switch (requestedChannel) {
      case NotificationChannel.BOTH:
        if (emailAllowed && inAppAllowed) return NotificationChannel.BOTH;
        if (emailAllowed) return NotificationChannel.EMAIL;
        if (inAppAllowed) return NotificationChannel.IN_APP;
        return null;
      case NotificationChannel.EMAIL:
        return emailAllowed ? NotificationChannel.EMAIL : null;
      case NotificationChannel.IN_APP:
        return inAppAllowed ? NotificationChannel.IN_APP : null;
      default:
        return requestedChannel;
    }
  }

  private async resolveTenantSlug(tenantId?: string): Promise<string | null> {
    if (!tenantId) return null;
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('slug')
      .eq('id', tenantId)
      .single();

    if (error) {
      logger.warn('Failed to resolve tenant slug for notification delivery', {
        tenantId,
        error: error.message
      });
      return null;
    }

    return data?.slug || null;
  }

  /**
   * Shutdown the notification service
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Notification service shutdown completed');
    } catch (error) {
      logger.error('Error during notification service shutdown:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
export default notificationService;

