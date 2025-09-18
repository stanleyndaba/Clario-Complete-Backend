import { getLogger } from '../../utils/logger';
import { getDatabase } from '../../db/connection';
import { Notification } from '../models/notification.model';

const logger = getLogger('InAppService');

export interface InAppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  priority: 'low' | 'medium' | 'high';
  actions?: Array<{
    label: string;
    action: string;
    url?: string;
  }>;
  metadata?: Record<string, any>;
  expiresAt?: Date;
  category?: string;
  read: boolean;
  createdAt: Date;
}

export interface InAppNotificationOptions {
  userId: string;
  title: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  priority?: 'low' | 'medium' | 'high';
  actions?: Array<{
    label: string;
    action: string;
    url?: string;
  }>;
  metadata?: Record<string, any>;
  expiresAt?: Date;
  category?: string;
}

class InAppService {
  private io: any = null;
  private userConnections: Map<string, string[]> = new Map();

  constructor() {
    // Initialize Socket.io if available
    this.initializeSocketIO();
  }

  private initializeSocketIO(): void {
    try {
      // Check if Socket.io is available in the global scope
      if (typeof global !== 'undefined' && (global as any).io) {
        this.io = (global as any).io;
        this.setupSocketHandlers();
        logger.info('Initialized Socket.io for in-app notifications');
      } else {
        logger.warn('Socket.io not available, in-app notifications will be stored only');
      }
    } catch (error) {
      logger.error('Failed to initialize Socket.io:', error);
    }
  }

  private setupSocketHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: any) => {
      logger.info(`User connected: ${socket.id}`);

      // Handle user authentication
      socket.on('authenticate', (data: { userId: string }) => {
        const { userId } = data;
        this.addUserConnection(userId, socket.id);
        logger.info(`User ${userId} authenticated on socket ${socket.id}`);
      });

      // Handle notification read
      socket.on('mark-read', async (data: { notificationId: string }) => {
        try {
          await this.markAsRead(data.notificationId);
          socket.emit('notification-read', { notificationId: data.notificationId });
        } catch (error) {
          logger.error('Failed to mark notification as read:', error);
        }
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.removeUserConnection(socket.id);
        logger.info(`User disconnected: ${socket.id}`);
      });
    });
  }

  private addUserConnection(userId: string, socketId: string): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, []);
    }
    this.userConnections.get(userId)!.push(socketId);
  }

  private removeUserConnection(socketId: string): void {
    for (const [userId, connections] of this.userConnections.entries()) {
      const index = connections.indexOf(socketId);
      if (index > -1) {
        connections.splice(index, 1);
        if (connections.length === 0) {
          this.userConnections.delete(userId);
        }
        break;
      }
    }
  }

  async createNotification(options: InAppNotificationOptions): Promise<InAppNotification> {
    const db = getDatabase();
    const now = new Date();

    const notificationData = {
      id: `inapp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: options.userId,
      title: options.title,
      message: options.message,
      type: options.type || 'info',
      priority: options.priority || 'medium',
      actions: options.actions || [],
      metadata: options.metadata || {},
      expiresAt: options.expiresAt,
      category: options.category,
      read: false,
      createdAt: now,
    };

    // Store in database
    const [notification] = await db('inapp_notifications').insert(notificationData).returning('*');

    // Send real-time notification if Socket.io is available
    if (this.io) {
      this.sendRealTimeNotification(options.userId, notificationData);
    }

    logger.info(`Created in-app notification ${notificationData.id} for user ${options.userId}`);

    return notificationData as InAppNotification;
  }

  private sendRealTimeNotification(userId: string, notification: InAppNotification): void {
    if (!this.io) return;

    const userConnections = this.userConnections.get(userId);
    if (userConnections && userConnections.length > 0) {
      userConnections.forEach(socketId => {
        this.io.to(socketId).emit('new-notification', notification);
      });
      logger.info(`Sent real-time notification to user ${userId} on ${userConnections.length} connections`);
    }
  }

  async getNotifications(userId: string, limit: number = 50, offset: number = 0): Promise<InAppNotification[]> {
    const db = getDatabase();
    const notifications = await db('inapp_notifications')
      .where({ userId })
      .where('expiresAt', '>', new Date())
      .orWhereNull('expiresAt')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset);

    return notifications.map(n => ({
      ...n,
      actions: n.actions ? JSON.parse(n.actions) : [],
      metadata: n.metadata ? JSON.parse(n.metadata) : {},
    }));
  }

  async getUnreadCount(userId: string): Promise<number> {
    const db = getDatabase();
    const count = await db('inapp_notifications')
      .where({ userId, read: false })
      .where('expiresAt', '>', new Date())
      .orWhereNull('expiresAt')
      .count('* as count')
      .first();

    return parseInt(count?.count || '0');
  }

  async markAsRead(notificationId: string): Promise<void> {
    const db = getDatabase();
    await db('inapp_notifications')
      .where({ id: notificationId })
      .update({ read: true, updatedAt: new Date() });

    logger.info(`Marked notification ${notificationId} as read`);
  }

  async markAllAsRead(userId: string): Promise<void> {
    const db = getDatabase();
    await db('inapp_notifications')
      .where({ userId, read: false })
      .update({ read: true, updatedAt: new Date() });

    logger.info(`Marked all notifications as read for user ${userId}`);
  }

  async deleteNotification(notificationId: string): Promise<void> {
    const db = getDatabase();
    await db('inapp_notifications')
      .where({ id: notificationId })
      .del();

    logger.info(`Deleted notification ${notificationId}`);
  }

  async deleteExpiredNotifications(): Promise<number> {
    const db = getDatabase();
    const result = await db('inapp_notifications')
      .where('expiresAt', '<', new Date())
      .del();

    logger.info(`Deleted ${result} expired notifications`);
    return result;
  }

  async getNotificationStats(userId: string): Promise<{
    total: number;
    unread: number;
    read: number;
    byType: Record<string, number>;
  }> {
    const db = getDatabase();
    
    const [total, unread] = await Promise.all([
      db('inapp_notifications').where({ userId }).count('* as count').first(),
      db('inapp_notifications').where({ userId, read: false }).count('* as count').first(),
    ]);

    const byType = await db('inapp_notifications')
      .where({ userId })
      .select('type')
      .count('* as count')
      .groupBy('type');

    const typeStats: Record<string, number> = {};
    byType.forEach((item: any) => {
      typeStats[item.type] = parseInt(item.count);
    });

    return {
      total: parseInt(total?.count || '0'),
      unread: parseInt(unread?.count || '0'),
      read: parseInt(total?.count || '0') - parseInt(unread?.count || '0'),
      byType: typeStats,
    };
  }

  // Method to be called by the main notification service
  async sendNotification(userId: string, templateId: string, data: Record<string, any>): Promise<boolean> {
    try {
      const template = await this.loadTemplate(templateId);
      const notificationData = this.replacePlaceholders(template, data);

      await this.createNotification({
        userId,
        title: notificationData.title,
        message: notificationData.message,
        type: notificationData.type || 'info',
        priority: notificationData.priority || 'medium',
        actions: notificationData.actions || [],
        metadata: notificationData.metadata || {},
        expiresAt: notificationData.expiresAt ? new Date(notificationData.expiresAt) : undefined,
        category: notificationData.category,
      });

      return true;
    } catch (error) {
      logger.error(`Failed to send in-app notification ${templateId}:`, error);
      return false;
    }
  }

  private async loadTemplate(templateName: string): Promise<any> {
    const fs = require('fs');
    const path = require('path');
    
    try {
      const templatePath = path.join(__dirname, '../templates/inapp', `${templateName}.json`);
      const template = fs.readFileSync(templatePath, 'utf8');
      return JSON.parse(template);
    } catch (error) {
      logger.error(`Failed to load template ${templateName}:`, error);
      throw new Error(`Template ${templateName} not found`);
    }
  }

  private replacePlaceholders(template: any, data: Record<string, any>): any {
    const result = JSON.parse(JSON.stringify(template));
    
    const replaceInObject = (obj: any): any => {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          for (const [placeholder, replacement] of Object.entries(data)) {
            obj[key] = value.replace(new RegExp(`{{${placeholder}}}`, 'g'), String(replacement));
          }
        } else if (typeof value === 'object' && value !== null) {
          obj[key] = replaceInObject(value);
        }
      }
      return obj;
    };

    return replaceInObject(result);
  }
}

export const inAppService = new InAppService();
export default inAppService; 