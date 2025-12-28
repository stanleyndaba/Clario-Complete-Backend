import { Request, Response } from 'express';
import { getLogger } from '../../utils/logger';
import { notificationService } from '../services/notification_service';
import { NotificationType, NotificationPriority, NotificationChannel } from '../models/notification';
import { AuthenticatedRequest } from '../../middleware/authMiddleware';

const logger = getLogger('NotificationController');

export class NotificationController {
  /**
   * Get all notifications for the authenticated user
   * GET /notifications
   */
  async getNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      // Extract query parameters
      const {
        type,
        status,
        priority,
        channel,
        unread_only,
        limit = '50',
        offset = '0'
      } = (req as any).query;

      // Build filters
      const filters: any = {
        user_id: userId,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };

      if (type && Object.values(NotificationType).includes(type as NotificationType)) {
        filters.type = type;
      }
      if (status) {
        filters.status = status;
      }
      if (priority && Object.values(NotificationPriority).includes(priority as NotificationPriority)) {
        filters.priority = priority;
      }
      if (channel && Object.values(NotificationChannel).includes(channel as NotificationChannel)) {
        filters.channel = channel;
      }
      if (unread_only === 'true') {
        filters.unread_only = true;
      }

      const notifications = await notificationService.getNotifications(filters);

      res.json({
        success: true,
        data: notifications,
        meta: {
          count: notifications.length,
          filters,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Error getting notifications:', error);
      res.status(500).json({
        error: 'Failed to fetch notifications',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get a specific notification by ID
   * GET /notifications/:id
   */
  async getNotificationById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const { id } = (req as any).params;
      if (!id) {
        res.status(400).json({ error: 'Notification ID is required' });
        return;
      }

      const notification = await notificationService.getNotificationById(id);

      if (!notification) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }

      // Ensure user can only access their own notifications
      if (notification.user_id !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      res.json({
        success: true,
        data: notification
      });
    } catch (error) {
      logger.error('Error getting notification by ID:', error);
      res.status(500).json({
        error: 'Failed to fetch notification',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Mark a notification as read
   * POST /notifications/mark-read
   */
  async markAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const { notificationIds } = (req as any).body;

      if (!notificationIds) {
        res.status(400).json({ error: 'Notification IDs are required' });
        return;
      }

      let result;
      if (Array.isArray(notificationIds)) {
        // Mark multiple notifications as read
        result = await notificationService.markMultipleAsRead(notificationIds);
      } else {
        // Mark single notification as read
        const notification = await notificationService.markAsRead(notificationIds);
        result = [notification];
      }

      res.json({
        success: true,
        data: result,
        meta: {
          count: result.length,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Error marking notifications as read:', error);
      res.status(500).json({
        error: 'Failed to mark notifications as read',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Mark all notifications as read (bulk)
   * POST /notifications/mark-all-read
   */
  async markAllAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const count = await notificationService.markAllAsRead(userId);

      res.json({
        success: true,
        message: `Marked ${count} notifications as read`,
        meta: {
          count,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
      res.status(500).json({
        error: 'Failed to mark all notifications as read',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Create a new notification manually
   * POST /notifications
   */
  async createNotification(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const {
        type,
        title,
        message,
        priority,
        channel,
        payload,
        expires_at,
        immediate
      } = (req as any).body;

      // Validate required fields
      if (!type || !title || !message) {
        res.status(400).json({
          error: 'Missing required fields',
          required: ['type', 'title', 'message']
        });
        return;
      }

      // Validate notification type
      if (!Object.values(NotificationType).includes(type)) {
        res.status(400).json({
          error: 'Invalid notification type',
          validTypes: Object.values(NotificationType)
        });
        return;
      }

      // Create notification event
      const notificationEvent = {
        type: type as NotificationType,
        user_id: userId,
        title,
        message,
        priority: priority as NotificationPriority || NotificationPriority.NORMAL,
        channel: channel as NotificationChannel || NotificationChannel.IN_APP,
        payload,
        expires_at: expires_at ? new Date(expires_at) : undefined,
        immediate: immediate === true
      };

      const notification = await notificationService.createNotification(notificationEvent);

      res.status(201).json({
        success: true,
        data: notification,
        message: 'Notification created successfully'
      });
    } catch (error) {
      logger.error('Error creating notification:', error);
      res.status(500).json({
        error: 'Failed to create notification',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Update a notification
   * PUT /notifications/:id
   */
  async updateNotification(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const { id } = (req as any).params;
      if (!id) {
        res.status(400).json({ error: 'Notification ID is required' });
        return;
      }

      const updates = (req as any).body;
      if (!updates || Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'Update data is required' });
        return;
      }

      // Get the notification first to check ownership
      const existingNotification = await notificationService.getNotificationById(id);
      if (!existingNotification) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }

      // Ensure user can only update their own notifications
      if (existingNotification.user_id !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const updatedNotification = await notificationService.updateNotification(id, updates);

      res.json({
        success: true,
        data: updatedNotification,
        message: 'Notification updated successfully'
      });
    } catch (error) {
      logger.error('Error updating notification:', error);
      res.status(500).json({
        error: 'Failed to update notification',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Delete a notification
   * DELETE /notifications/:id
   */
  async deleteNotification(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const { id } = (req as any).params;
      if (!id) {
        res.status(400).json({ error: 'Notification ID is required' });
        return;
      }

      // Get the notification first to check ownership
      const existingNotification = await notificationService.getNotificationById(id);
      if (!existingNotification) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }

      // Ensure user can only delete their own notifications
      if (existingNotification.user_id !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      await notificationService.deleteNotification(id);

      res.json({
        success: true,
        message: 'Notification deleted successfully'
      });
    } catch (error) {
      logger.error('Error deleting notification:', error);
      res.status(500).json({
        error: 'Failed to delete notification',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get notification statistics for the authenticated user
   * GET /notifications/stats
   */
  async getNotificationStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }

      const stats = await notificationService.getNotificationStats(userId);

      res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error getting notification stats:', error);
      res.status(500).json({
        error: 'Failed to fetch notification statistics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get available notification types
   * GET /notifications/types
   */
  async getNotificationTypes(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      res.json({
        success: true,
        data: {
          types: Object.values(NotificationType),
          priorities: Object.values(NotificationPriority),
          channels: Object.values(NotificationChannel)
        }
      });
    } catch (error) {
      logger.error('Error getting notification types:', error);
      res.status(500).json({
        error: 'Failed to fetch notification types',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Health check endpoint
   * GET /notifications/health
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      res.json({
        success: true,
        status: 'healthy',
        service: 'notifications',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    } catch (error) {
      logger.error('Health check failed:', error);
      res.status(500).json({
        success: false,
        status: 'unhealthy',
        error: 'Health check failed'
      });
    }
  }
}

export default NotificationController;

