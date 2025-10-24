"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserNotificationPreference = exports.Notification = exports.notificationQueue = exports.inAppService = exports.pushService = exports.emailService = exports.notificationService = exports.notificationsService = void 0;
const logger_1 = require("../utils/logger");
const notification_service_1 = __importDefault(require("./services/notification.service"));
const queue_1 = require("./utils/queue");
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const logger = (0, logger_1.getLogger)('NotificationsService');
class NotificationsService {
    constructor() {
        this.isInitialized = false;
    }
    async initialize() {
        if (this.isInitialized) {
            logger.info('Notifications service already initialized');
            return;
        }
        try {
            // Initialize queue connection
            await queue_1.notificationQueue.connect();
            // Start consuming notifications
            await queue_1.notificationQueue.consume(async (message) => {
                await notification_service_1.default.processQueuedNotification(message);
            });
            this.isInitialized = true;
            logger.info('Notifications service initialized successfully');
        }
        catch (error) {
            logger.error('Failed to initialize notifications service:', error);
            throw error;
        }
    }
    async shutdown() {
        try {
            await queue_1.notificationQueue.close();
            this.isInitialized = false;
            logger.info('Notifications service shut down successfully');
        }
        catch (error) {
            logger.error('Failed to shut down notifications service:', error);
        }
    }
    // Expose the service for external use
    getService() {
        return notification_service_1.default;
    }
    // Expose routes for Express app
    getRoutes() {
        return notification_routes_1.default;
    }
    // Health check
    async healthCheck() {
        try {
            return await queue_1.notificationQueue.healthCheck();
        }
        catch (error) {
            logger.error('Notifications service health check failed:', error);
            return false;
        }
    }
}
// Singleton instance
exports.notificationsService = new NotificationsService();
// Export individual components for direct use
var notification_service_2 = require("./services/notification.service");
Object.defineProperty(exports, "notificationService", { enumerable: true, get: function () { return notification_service_2.notificationService; } });
var email_service_1 = require("./services/email.service");
Object.defineProperty(exports, "emailService", { enumerable: true, get: function () { return email_service_1.emailService; } });
var push_service_1 = require("./services/push.service");
Object.defineProperty(exports, "pushService", { enumerable: true, get: function () { return push_service_1.pushService; } });
var inapp_service_1 = require("./services/inapp.service");
Object.defineProperty(exports, "inAppService", { enumerable: true, get: function () { return inapp_service_1.inAppService; } });
var queue_2 = require("./utils/queue");
Object.defineProperty(exports, "notificationQueue", { enumerable: true, get: function () { return queue_2.notificationQueue; } });
var notification_model_1 = require("./models/notification.model");
Object.defineProperty(exports, "Notification", { enumerable: true, get: function () { return notification_model_1.Notification; } });
Object.defineProperty(exports, "UserNotificationPreference", { enumerable: true, get: function () { return notification_model_1.UserNotificationPreference; } });
exports.default = exports.notificationsService;
//# sourceMappingURL=index.js.map