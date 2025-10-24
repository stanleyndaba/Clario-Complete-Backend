"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const logger_1 = require("../../utils/logger");
const notification_model_1 = require("../models/notification.model");
const queue_1 = require("../utils/queue");
const email_service_1 = __importDefault(require("./email.service"));
const push_service_1 = __importDefault(require("./push.service"));
const inapp_service_1 = __importDefault(require("./inapp.service"));
const connection_1 = require("../../db/connection");
const logger = (0, logger_1.getLogger)('NotificationService');
class NotificationService {
    constructor() {
        this.templates = new Map();
        this.initializeTemplates();
    }
    initializeTemplates() {
        // Initialize default templates
        const defaultTemplates = [
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
    async processEvent(event) {
        try {
            logger.info(`Processing notification event: ${event.type} for user ${event.userId}`);
            // Get user preferences
            const userPreferences = await this.getUserPreferences(event.userId, event.type);
            // Determine which channels to use
            const channels = event.channels || this.getDefaultChannels(event.type);
            const enabledChannels = channels.filter(channel => userPreferences.some(pref => pref.channel === channel && pref.enabled));
            if (enabledChannels.length === 0) {
                logger.info(`No enabled channels for user ${event.userId} and event ${event.type}`);
                return;
            }
            // Create notification records and queue messages
            const promises = enabledChannels.map(channel => this.createNotification(event, channel));
            await Promise.all(promises);
            logger.info(`Processed notification event ${event.type} for user ${event.userId} on ${enabledChannels.length} channels`);
        }
        catch (error) {
            logger.error(`Failed to process notification event ${event.type}:`, error);
            throw error;
        }
    }
    async getUserPreferences(userId, type) {
        try {
            const preferences = await notification_model_1.UserNotificationPreference.findByUserIdAndType(userId, type);
            // If no preferences found, create default ones
            if (preferences.length === 0) {
                const defaultChannels = this.getDefaultChannels(type);
                const defaultPreferences = defaultChannels.map(channel => notification_model_1.UserNotificationPreference.create({
                    userId,
                    channel,
                    type,
                    enabled: true,
                }));
                return Promise.all(defaultPreferences);
            }
            return preferences;
        }
        catch (error) {
            logger.error(`Failed to get user preferences for ${userId}:`, error);
            return [];
        }
    }
    getDefaultChannels(type) {
        const template = this.templates.get(type);
        return template?.channels || ['inapp'];
    }
    async createNotification(event, channel) {
        try {
            // Create notification record
            const notification = await notification_model_1.Notification.create({
                userId: event.userId,
                type: event.type,
                channel,
                templateId: event.type,
                payload: event.data,
                status: 'pending',
            });
            // Queue the notification for processing
            const queueMessage = {
                id: notification.id,
                type: event.type,
                userId: event.userId,
                channel,
                templateId: event.type,
                payload: event.data,
                priority: event.priority || 0,
                scheduledAt: event.scheduledAt,
            };
            await queue_1.notificationQueue.publish(queueMessage);
            logger.info(`Queued notification ${notification.id} for channel ${channel}`);
        }
        catch (error) {
            logger.error(`Failed to create notification for channel ${channel}:`, error);
            throw error;
        }
    }
    async processQueuedNotification(message) {
        try {
            logger.info(`Processing queued notification ${message.id} for channel ${message.channel}`);
            const notification = await notification_model_1.Notification.findById(message.id);
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
            }
            else {
                await notification.markAsFailed('Failed to send notification');
                logger.error(`Failed to send notification ${message.id} via ${message.channel}`);
            }
        }
        catch (error) {
            logger.error(`Failed to process queued notification ${message.id}:`, error);
            // Mark as failed
            const notification = await notification_model_1.Notification.findById(message.id);
            if (notification) {
                await notification.markAsFailed(error.message);
            }
        }
    }
    async sendEmailNotification(notification, message) {
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
            return await email_service_1.default.sendTemplatedEmail(user.email, message.templateId, message.payload, template.subject);
        }
        catch (error) {
            logger.error(`Failed to send email notification:`, error);
            return false;
        }
    }
    async sendPushNotification(notification, message) {
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
                priority: 'normal',
            };
            return await push_service_1.default.sendToUser(notification.userId, pushNotification);
        }
        catch (error) {
            logger.error(`Failed to send push notification:`, error);
            return false;
        }
    }
    async sendInAppNotification(notification, message) {
        try {
            return await inapp_service_1.default.sendNotification(notification.userId, message.templateId, message.payload);
        }
        catch (error) {
            logger.error(`Failed to send in-app notification:`, error);
            return false;
        }
    }
    async sendSlackNotification(notification, message) {
        // TODO: Implement Slack integration
        logger.warn('Slack notifications not yet implemented');
        return false;
    }
    async getUser(userId) {
        const db = (0, connection_1.getDatabase)();
        return await db('users').where({ id: userId }).first();
    }
    replacePlaceholders(template, data) {
        let result = template;
        for (const [key, value] of Object.entries(data)) {
            const placeholder = `{{${key}}}`;
            result = result.replace(new RegExp(placeholder, 'g'), String(value));
        }
        return result;
    }
    async getNotificationHistory(userId, limit = 50, offset = 0) {
        return await notification_model_1.Notification.findByUserId(userId, limit, offset);
    }
    async updateUserPreferences(userId, preferences) {
        const db = (0, connection_1.getDatabase)();
        for (const preference of preferences) {
            await db('user_notification_preferences')
                .where({ userId, channel: preference.channel, type: preference.type })
                .update({ enabled: preference.enabled, updatedAt: new Date() });
        }
        logger.info(`Updated notification preferences for user ${userId}`);
    }
    async getNotificationStats(userId) {
        const db = (0, connection_1.getDatabase)();
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
        const channelStats = {};
        byChannel.forEach((item) => {
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
    async onFbaReportReady(userId, reportId, reportType) {
        await this.processEvent({
            type: 'fba_report_ready',
            userId,
            data: { reportId, reportType, generatedAt: new Date().toISOString() },
        });
    }
    async onLowStockAlert(userId, productName, sku, currentStock) {
        await this.processEvent({
            type: 'low_stock_alert',
            userId,
            data: { productName, sku, currentStock, lastUpdated: new Date().toISOString() },
        });
    }
    async onDisputeApproved(userId, disputeId, amount) {
        await this.processEvent({
            type: 'dispute_approved',
            userId,
            data: { disputeId, amount, approvedAt: new Date().toISOString() },
        });
    }
    async onSyncCompleted(userId, recordCount) {
        await this.processEvent({
            type: 'sync_completed',
            userId,
            data: { recordCount, completedAt: new Date().toISOString() },
        });
    }
}
exports.notificationService = new NotificationService();
exports.default = exports.notificationService;
//# sourceMappingURL=notification.service.js.map