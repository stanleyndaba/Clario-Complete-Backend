"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushService = void 0;
const logger_1 = require("../../utils/logger");
const admin = __importStar(require("firebase-admin"));
const fs = __importStar(require("fs"));
const logger = (0, logger_1.getLogger)('PushService');
class PushService {
    constructor() {
        this.app = null;
        this.isInitialized = false;
        this.initializeFirebase();
    }
    initializeFirebase() {
        try {
            // Check if Firebase is already initialized
            if (admin.apps.length > 0) {
                this.app = admin.app();
                this.isInitialized = true;
                logger.info('Using existing Firebase app');
                return;
            }
            // Initialize Firebase Admin SDK
            const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
            let serviceAccount;
            if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
                // Load from file
                serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            }
            else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
                // Load from environment variable
                serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            }
            else {
                // Use default credentials (for Google Cloud)
                this.app = admin.initializeApp({
                    credential: admin.credential.applicationDefault(),
                });
                this.isInitialized = true;
                logger.info('Initialized Firebase with default credentials');
                return;
            }
            this.app = admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            this.isInitialized = true;
            logger.info('Initialized Firebase Admin SDK');
        }
        catch (error) {
            logger.error('Failed to initialize Firebase:', error);
        }
    }
    async sendNotification(options) {
        if (!this.isInitialized || !this.app) {
            logger.error('Firebase not initialized');
            return false;
        }
        try {
            const { token, topic, userId, notification } = options;
            const message = {
                notification: {
                    title: notification.title,
                    body: notification.body,
                    ...(notification.imageUrl && { imageUrl: notification.imageUrl }),
                },
                data: notification.data || {},
                ...(notification.clickAction && { fcmOptions: { link: notification.clickAction } }),
                android: {
                    priority: notification.priority || 'normal',
                    ...(notification.ttl && { ttl: notification.ttl * 1000 }),
                },
                apns: {
                    payload: {
                        aps: {
                            'mutable-content': 1,
                            ...(notification.ttl && { 'expiration': Math.floor(Date.now() / 1000) + notification.ttl }),
                        },
                    },
                },
            };
            let response;
            if (token) {
                // Send to specific device
                response = await this.app.messaging().send({
                    ...message,
                    token,
                });
                logger.info(`Push notification sent to device ${token}`);
            }
            else if (topic) {
                // Send to topic
                response = await this.app.messaging().send({
                    ...message,
                    topic,
                });
                logger.info(`Push notification sent to topic ${topic}`);
            }
            else if (userId) {
                // Send to user's devices (you'll need to implement user token management)
                const userTokens = await this.getUserTokens(userId);
                if (userTokens.length === 0) {
                    logger.warn(`No tokens found for user ${userId}`);
                    return false;
                }
                response = await this.app.messaging().sendMulticast({
                    ...message,
                    tokens: userTokens,
                });
                logger.info(`Push notification sent to ${userTokens.length} devices for user ${userId}`);
            }
            else {
                logger.error('No token, topic, or userId provided');
                return false;
            }
            return true;
        }
        catch (error) {
            logger.error('Failed to send push notification:', error);
            return false;
        }
    }
    async sendToTopic(topic, notification) {
        return this.sendNotification({ topic, notification });
    }
    async sendToUser(userId, notification) {
        return this.sendNotification({ userId, notification });
    }
    async sendToDevice(token, notification) {
        return this.sendNotification({ token, notification });
    }
    async subscribeToTopic(tokens, topic) {
        if (!this.isInitialized || !this.app) {
            logger.error('Firebase not initialized');
            return false;
        }
        try {
            const response = await this.app.messaging().subscribeToTopic(tokens, topic);
            logger.info(`Subscribed ${tokens.length} devices to topic ${topic}`);
            return response.successCount > 0;
        }
        catch (error) {
            logger.error('Failed to subscribe to topic:', error);
            return false;
        }
    }
    async unsubscribeFromTopic(tokens, topic) {
        if (!this.isInitialized || !this.app) {
            logger.error('Firebase not initialized');
            return false;
        }
        try {
            const response = await this.app.messaging().unsubscribeFromTopic(tokens, topic);
            logger.info(`Unsubscribed ${tokens.length} devices from topic ${topic}`);
            return response.successCount > 0;
        }
        catch (error) {
            logger.error('Failed to unsubscribe from topic:', error);
            return false;
        }
    }
    async getUserTokens(userId) {
        // This is a placeholder implementation
        // In a real application, you would store and retrieve user FCM tokens from your database
        const db = require('../../db/connection').getDatabase();
        const tokens = await db('user_fcm_tokens')
            .where({ userId })
            .select('token')
            .pluck('token');
        return tokens;
    }
    async validateToken(token) {
        if (!this.isInitialized || !this.app) {
            return false;
        }
        try {
            // Try to send a test message to validate the token
            await this.app.messaging().send({
                token,
                data: { test: 'validation' },
            });
            return true;
        }
        catch (error) {
            logger.warn(`Invalid FCM token: ${token}`);
            return false;
        }
    }
    async getTopicSubscribers(topic) {
        // This is a placeholder implementation
        // Firebase doesn't provide a direct API to get topic subscribers count
        // You would need to maintain this information in your database
        return 0;
    }
}
exports.pushService = new PushService();
exports.default = exports.pushService;
//# sourceMappingURL=push.service.js.map