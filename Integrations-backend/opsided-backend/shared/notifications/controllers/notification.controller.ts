import { Request, Response } from 'express';
import { getLogger } from '../../utils/logger';
import notificationService from '../services/notification.service';
import { Notification, UserNotificationPreference } from '../models/notification.model';
import { createError } from '../../utils/errorHandler';

const logger = getLogger('NotificationController');

export class NotificationController {
  // Send a notification manually
  async sendNotification(req: Request, res: Response): Promise<void> {
    try {
      const { userId, type, data, channels, priority, scheduledAt } = req.body;

      if (!userId || !type || !data) {
        throw createError('Missing required fields: userId, type, data', 400);
      }

      await notificationService.processEvent({
        type,
        userId,
        data,
        channels,
        priority,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      });

      res.json({
        success: true,
        message: 'Notification queued successfully',
      });
    } catch (error) {
      logger.error('Failed to send notification:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Get notifications for a user
  async getNotifications(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { limit = 50, offset = 0 } = req.query;
      const notifications = await notificationService.getNotificationHistory(
        userId,
        parseInt(limit as string),
        parseInt(offset as string)
      );

      res.json({
        success: true,
        data: notifications.map(n => n.toJSON()),
      });
    } catch (error) {
      logger.error('Failed to get notifications:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Get notification statistics
  async getNotificationStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const stats = await notificationService.getNotificationStats(userId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Failed to get notification stats:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Get user notification preferences
  async getPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const preferences = await UserNotificationPreference.findByUserId(userId);

      res.json({
        success: true,
        data: preferences.map(p => p.toJSON()),
      });
    } catch (error) {
      logger.error('Failed to get preferences:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Update user notification preferences
  async updatePreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { preferences } = req.body;

      if (!Array.isArray(preferences)) {
        throw createError('Preferences must be an array', 400);
      }

      await notificationService.updateUserPreferences(userId, preferences);

      res.json({
        success: true,
        message: 'Preferences updated successfully',
      });
    } catch (error) {
      logger.error('Failed to update preferences:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Mark notification as read
  async markAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { notificationId } = req.params;

      const notification = await Notification.findById(notificationId);
      if (!notification) {
        throw createError('Notification not found', 404);
      }

      if (notification.userId !== userId) {
        throw createError('Unauthorized', 403);
      }

      await notification.markAsRead();

      res.json({
        success: true,
        message: 'Notification marked as read',
      });
    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Mark all notifications as read
  async markAllAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      // This would need to be implemented in the service
      // For now, we'll mark all notifications as read in the database
      const db = require('../../db/connection').getDatabase();
      await db('notifications')
        .where({ userId, status: 'sent' })
        .update({ status: 'delivered', deliveredAt: new Date() });

      res.json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (error) {
      logger.error('Failed to mark all notifications as read:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Delete a notification
  async deleteNotification(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw createError('User not authenticated', 401);
      }

      const { notificationId } = req.params;

      const notification = await Notification.findById(notificationId);
      if (!notification) {
        throw createError('Notification not found', 404);
      }

      if (notification.userId !== userId) {
        throw createError('Unauthorized', 403);
      }

      // Soft delete by updating status
      await notification.update({ status: 'deleted' });

      res.json({
        success: true,
        message: 'Notification deleted successfully',
      });
    } catch (error) {
      logger.error('Failed to delete notification:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Get notification templates
  async getTemplates(req: Request, res: Response): Promise<void> {
    try {
      // Return available templates
      const templates = [
        {
          id: 'low_stock_alert',
          name: 'Low Stock Alert',
          channels: ['email', 'inapp'],
          description: 'Sent when product stock is running low',
        },
        {
          id: 'fba_report_ready',
          name: 'FBA Report Ready',
          channels: ['inapp', 'email'],
          description: 'Sent when FBA report is ready for review',
        },
        {
          id: 'dispute_approved',
          name: 'Dispute Approved',
          channels: ['email', 'inapp', 'push'],
          description: 'Sent when a dispute is approved',
        },
        {
          id: 'sync_completed',
          name: 'Sync Completed',
          channels: ['inapp'],
          description: 'Sent when data sync is completed',
        },
      ];

      res.json({
        success: true,
        data: templates,
      });
    } catch (error) {
      logger.error('Failed to get templates:', error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  // Health check endpoint
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const queueHealth = await require('../utils/queue').notificationQueue.healthCheck();
      
      res.json({
        success: true,
        data: {
          status: 'healthy',
          queue: queueHealth ? 'connected' : 'disconnected',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Health check failed:', error);
      res.status(500).json({
        success: false,
        message: 'Service unhealthy',
        error: error.message,
      });
    }
  }
}

export const notificationController = new NotificationController();
export default notificationController; 