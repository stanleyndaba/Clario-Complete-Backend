"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserNotificationPreference = exports.Notification = void 0;
const connection_1 = require("../../db/connection");
const logger_1 = require("../../utils/logger");
const logger = (0, logger_1.getLogger)('NotificationModel');
class Notification {
    constructor(data) {
        this.id = data.id;
        this.userId = data.userId;
        this.type = data.type;
        this.channel = data.channel;
        this.templateId = data.templateId;
        this.payload = data.payload;
        this.status = data.status;
        this.errorMessage = data.errorMessage;
        this.sentAt = data.sentAt;
        this.deliveredAt = data.deliveredAt;
        this.openedAt = data.openedAt;
        this.createdAt = data.createdAt;
        this.updatedAt = data.updatedAt;
    }
    static async findById(id) {
        const db = (0, connection_1.getDatabase)();
        const notification = await db('notifications').where({ id }).first();
        return notification ? new Notification(notification) : null;
    }
    static async findByUserId(userId, limit = 50, offset = 0) {
        const db = (0, connection_1.getDatabase)();
        const notifications = await db('notifications')
            .where({ userId })
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .offset(offset);
        return notifications.map(n => new Notification(n));
    }
    static async findByStatus(status) {
        const db = (0, connection_1.getDatabase)();
        const notifications = await db('notifications')
            .where({ status })
            .orderBy('createdAt', 'desc');
        return notifications.map(n => new Notification(n));
    }
    static async create(data) {
        const db = (0, connection_1.getDatabase)();
        const now = new Date();
        const [notification] = await db('notifications').insert({
            ...data,
            createdAt: now,
            updatedAt: now,
        }).returning('*');
        logger.info(`Created notification ${notification.id} for user ${data.userId}`);
        return new Notification(notification);
    }
    async update(data) {
        const db = (0, connection_1.getDatabase)();
        await db('notifications').where({ id: this.id }).update({
            ...data,
            updatedAt: new Date(),
        });
        // Update local instance
        Object.assign(this, data, { updatedAt: new Date() });
    }
    async markAsSent() {
        await this.update({ status: 'sent', sentAt: new Date() });
    }
    async markAsDelivered() {
        await this.update({ status: 'delivered', deliveredAt: new Date() });
    }
    async markAsOpened() {
        await this.update({ status: 'opened', openedAt: new Date() });
    }
    async markAsFailed(errorMessage) {
        await this.update({ status: 'failed', errorMessage });
    }
    toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            type: this.type,
            channel: this.channel,
            templateId: this.templateId,
            payload: this.payload,
            status: this.status,
            errorMessage: this.errorMessage,
            sentAt: this.sentAt,
            deliveredAt: this.deliveredAt,
            openedAt: this.openedAt,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}
exports.Notification = Notification;
class UserNotificationPreference {
    constructor(data) {
        this.id = data.id;
        this.userId = data.userId;
        this.channel = data.channel;
        this.type = data.type;
        this.enabled = data.enabled;
        this.createdAt = data.createdAt;
        this.updatedAt = data.updatedAt;
    }
    static async findByUserId(userId) {
        const db = (0, connection_1.getDatabase)();
        const preferences = await db('user_notification_preferences').where({ userId });
        return preferences.map(p => new UserNotificationPreference(p));
    }
    static async findByUserIdAndType(userId, type) {
        const db = (0, connection_1.getDatabase)();
        const preferences = await db('user_notification_preferences').where({ userId, type });
        return preferences.map(p => new UserNotificationPreference(p));
    }
    static async create(data) {
        const db = (0, connection_1.getDatabase)();
        const now = new Date();
        const [preference] = await db('user_notification_preferences').insert({
            ...data,
            createdAt: now,
            updatedAt: now,
        }).returning('*');
        return new UserNotificationPreference(preference);
    }
    async update(data) {
        const db = (0, connection_1.getDatabase)();
        await db('user_notification_preferences').where({ id: this.id }).update({
            ...data,
            updatedAt: new Date(),
        });
        // Update local instance
        Object.assign(this, data, { updatedAt: new Date() });
    }
    toJSON() {
        return {
            id: this.id,
            userId: this.userId,
            channel: this.channel,
            type: this.type,
            enabled: this.enabled,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }
}
exports.UserNotificationPreference = UserNotificationPreference;
//# sourceMappingURL=notification.model.js.map