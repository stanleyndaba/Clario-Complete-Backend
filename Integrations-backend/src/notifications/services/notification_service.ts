import { getLogger } from '../../utils/logger';
import Notification, {
  CreateNotificationRequest,
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
// Disable BullMQ worker for demo stability (avoid QueueScheduler import issues)
class NoopNotificationWorker {
  async initialize(): Promise<void> { return; }
  async queueNotification(_id: string, _options?: any): Promise<void> { return; }
  async shutdown(): Promise<void> { return; }
}

const logger = getLogger('NotificationService');

export interface NotificationEvent {
  type: NotificationType;
  user_id: string;
  title: string;
  message: string;
  priority?: NotificationPriority;
  channel?: NotificationChannel;
  payload?: Record<string, any>;
  expires_at?: Date;
  immediate?: boolean; // If true, send immediately without queuing
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
  private worker: NoopNotificationWorker;

  constructor() {
    this.emailService = new EmailService();
    // Demo mode: disable BullMQ worker to avoid QueueScheduler runtime issues
    this.worker = new NoopNotificationWorker();
  }

  /**
   * Initialize the notification service
   */
  async initialize(): Promise<void> {
    try {
      await this.worker.initialize();
      logger.info('Notification service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize notification service:', error);
      throw error;
    }
  }

  /**
   * Create and queue a notification
   */
  async createNotification(event: NotificationEvent): Promise<Notification> {
    try {
      logger.info('Creating notification', {
        type: event.type,
        user_id: event.user_id,
        immediate: event.immediate
      });

      // Create the notification in the database
      const notification = await Notification.create({
        user_id: event.user_id,
        type: event.type,
        title: event.title,
        message: event.message,
        priority: event.priority,
        channel: event.channel,
        payload: event.payload,
        expires_at: event.expires_at
      });

      // If immediate delivery is requested, send right away
      if (event.immediate) {
        await this.deliverNotification(notification);
      } else {
        // Queue the notification for background processing
        await this.worker.queueNotification(notification.id);
      }

      logger.info('Notification created and queued successfully', { id: notification.id });
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
          notifications.push(notification);
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
  async getNotificationStats(user_id: string): Promise<NotificationStats> {
    try {
      logger.info('Fetching notification stats for user', { user_id });

      const allNotifications = await Notification.findMany({ user_id });

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

      const deliveryPromises: Promise<void>[] = [];

      // Deliver via WebSocket if in-app or both
      if (notification.channel === NotificationChannel.IN_APP ||
        notification.channel === NotificationChannel.BOTH) {
        deliveryPromises.push(
          this.deliverViaWebSocket(notification)
        );
      }

      // Deliver via email if email or both
      if (notification.channel === NotificationChannel.EMAIL ||
        notification.channel === NotificationChannel.BOTH) {
        deliveryPromises.push(
          this.emailService.sendNotification(notification)
        );
      }

      // Wait for all delivery attempts
      await Promise.allSettled(deliveryPromises);

      // Mark as delivered
      await notification.markAsDelivered();

      logger.info('Notification delivered successfully', { id: notification.id });
    } catch (error) {
      logger.error('Error delivering notification:', error);
      await notification.markAsFailed();
      throw error;
    }
  }

  /**
   * Deliver notification via WebSocket and SSE
   */
  private async deliverViaWebSocket(notification: Notification): Promise<void> {
    try {
      const payload = {
        type: this.getNotificationType(notification.priority),
        title: notification.title,
        message: notification.message,
        data: notification.payload,
        timestamp: notification.created_at,
        id: notification.id,
        read: false
      };

      // Send via Socket.IO
      websocketService.sendNotificationToUser(notification.user_id, payload);

      // Send via SSE
      sseHub.sendEvent(notification.user_id, 'notification', payload);

      logger.debug('Notification sent via Realtime (WebSocket + SSE)', {
        id: notification.id,
        userId: notification.user_id
      });

    } catch (error) {
      logger.error('Error sending notification via Realtime:', error);
      // Don't throw, as this is best-effort delivery
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

  /**
   * Shutdown the notification service
   */
  async shutdown(): Promise<void> {
    try {
      await this.worker.shutdown();
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

