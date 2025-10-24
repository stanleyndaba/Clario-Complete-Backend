"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inAppService = void 0;
const logger_1 = require("../../utils/logger");
const connection_1 = require("../../db/connection");
const logger = (0, logger_1.getLogger)('InAppService');
class InAppService {
    constructor() {
        this.io = null;
        this.userConnections = new Map();
        // Initialize Socket.io if available
        this.initializeSocketIO();
    }
    initializeSocketIO() {
        try {
            // Check if Socket.io is available in the global scope
            if (typeof global !== 'undefined' && global.io) {
                this.io = global.io;
                this.setupSocketHandlers();
                logger.info('Initialized Socket.io for in-app notifications');
            }
            else {
                logger.warn('Socket.io not available, in-app notifications will be stored only');
            }
        }
        catch (error) {
            logger.error('Failed to initialize Socket.io:', error);
        }
    }
    setupSocketHandlers() {
        if (!this.io)
            return;
        this.io.on('connection', (socket) => {
            logger.info(`User connected: ${socket.id}`);
            // Handle user authentication
            socket.on('authenticate', (data) => {
                const { userId } = data;
                this.addUserConnection(userId, socket.id);
                logger.info(`User ${userId} authenticated on socket ${socket.id}`);
            });
            // Handle notification read
            socket.on('mark-read', async (data) => {
                try {
                    await this.markAsRead(data.notificationId);
                    socket.emit('notification-read', { notificationId: data.notificationId });
                }
                catch (error) {
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
    addUserConnection(userId, socketId) {
        if (!this.userConnections.has(userId)) {
            this.userConnections.set(userId, []);
        }
        this.userConnections.get(userId).push(socketId);
    }
    removeUserConnection(socketId) {
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
    async createNotification(options) {
        const db = (0, connection_1.getDatabase)();
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
        return notificationData;
    }
    sendRealTimeNotification(userId, notification) {
        if (!this.io)
            return;
        const userConnections = this.userConnections.get(userId);
        if (userConnections && userConnections.length > 0) {
            userConnections.forEach(socketId => {
                this.io.to(socketId).emit('new-notification', notification);
            });
            logger.info(`Sent real-time notification to user ${userId} on ${userConnections.length} connections`);
        }
    }
    async getNotifications(userId, limit = 50, offset = 0) {
        const db = (0, connection_1.getDatabase)();
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
    async getUnreadCount(userId) {
        const db = (0, connection_1.getDatabase)();
        const count = await db('inapp_notifications')
            .where({ userId, read: false })
            .where('expiresAt', '>', new Date())
            .orWhereNull('expiresAt')
            .count('* as count')
            .first();
        return parseInt(count?.count || '0');
    }
    async markAsRead(notificationId) {
        const db = (0, connection_1.getDatabase)();
        await db('inapp_notifications')
            .where({ id: notificationId })
            .update({ read: true, updatedAt: new Date() });
        logger.info(`Marked notification ${notificationId} as read`);
    }
    async markAllAsRead(userId) {
        const db = (0, connection_1.getDatabase)();
        await db('inapp_notifications')
            .where({ userId, read: false })
            .update({ read: true, updatedAt: new Date() });
        logger.info(`Marked all notifications as read for user ${userId}`);
    }
    async deleteNotification(notificationId) {
        const db = (0, connection_1.getDatabase)();
        await db('inapp_notifications')
            .where({ id: notificationId })
            .del();
        logger.info(`Deleted notification ${notificationId}`);
    }
    async deleteExpiredNotifications() {
        const db = (0, connection_1.getDatabase)();
        const result = await db('inapp_notifications')
            .where('expiresAt', '<', new Date())
            .del();
        logger.info(`Deleted ${result} expired notifications`);
        return result;
    }
    async getNotificationStats(userId) {
        const db = (0, connection_1.getDatabase)();
        const [total, unread] = await Promise.all([
            db('inapp_notifications').where({ userId }).count('* as count').first(),
            db('inapp_notifications').where({ userId, read: false }).count('* as count').first(),
        ]);
        const byType = await db('inapp_notifications')
            .where({ userId })
            .select('type')
            .count('* as count')
            .groupBy('type');
        const typeStats = {};
        byType.forEach((item) => {
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
    async sendNotification(userId, templateId, data) {
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
        }
        catch (error) {
            logger.error(`Failed to send in-app notification ${templateId}:`, error);
            return false;
        }
    }
    async loadTemplate(templateName) {
        const fs = require('fs');
        const path = require('path');
        try {
            const templatePath = path.join(__dirname, '../templates/inapp', `${templateName}.json`);
            const template = fs.readFileSync(templatePath, 'utf8');
            return JSON.parse(template);
        }
        catch (error) {
            logger.error(`Failed to load template ${templateName}:`, error);
            throw new Error(`Template ${templateName} not found`);
        }
    }
    replacePlaceholders(template, data) {
        const result = JSON.parse(JSON.stringify(template));
        const replaceInObject = (obj) => {
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === 'string') {
                    for (const [placeholder, replacement] of Object.entries(data)) {
                        obj[key] = value.replace(new RegExp(`{{${placeholder}}}`, 'g'), String(replacement));
                    }
                }
                else if (typeof value === 'object' && value !== null) {
                    obj[key] = replaceInObject(value);
                }
            }
            return obj;
        };
        return replaceInObject(result);
    }
}
exports.inAppService = new InAppService();
exports.default = exports.inAppService;
//# sourceMappingURL=inapp.service.js.map