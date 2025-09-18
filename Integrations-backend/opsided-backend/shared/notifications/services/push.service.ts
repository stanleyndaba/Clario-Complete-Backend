import { getLogger } from '../../utils/logger';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('PushService');

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  clickAction?: string;
  priority?: 'normal' | 'high';
  ttl?: number;
}

export interface PushNotificationOptions {
  token?: string;
  topic?: string;
  userId?: string;
  notification: PushNotification;
}

class PushService {
  private app: admin.app.App | null = null;
  private isInitialized = false;

  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
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
      let serviceAccount: admin.ServiceAccount;

      if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
        // Load from file
        serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Load from environment variable
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } else {
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
    } catch (error) {
      logger.error('Failed to initialize Firebase:', error);
    }
  }

  async sendNotification(options: PushNotificationOptions): Promise<boolean> {
    if (!this.isInitialized || !this.app) {
      logger.error('Firebase not initialized');
      return false;
    }

    try {
      const { token, topic, userId, notification } = options;
      const message: admin.messaging.Message = {
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

      let response: admin.messaging.BatchResponse | admin.messaging.TopicMessageResponse;

      if (token) {
        // Send to specific device
        response = await this.app.messaging().send({
          ...message,
          token,
        });
        logger.info(`Push notification sent to device ${token}`);
      } else if (topic) {
        // Send to topic
        response = await this.app.messaging().send({
          ...message,
          topic,
        });
        logger.info(`Push notification sent to topic ${topic}`);
      } else if (userId) {
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
      } else {
        logger.error('No token, topic, or userId provided');
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Failed to send push notification:', error);
      return false;
    }
  }

  async sendToTopic(topic: string, notification: PushNotification): Promise<boolean> {
    return this.sendNotification({ topic, notification });
  }

  async sendToUser(userId: string, notification: PushNotification): Promise<boolean> {
    return this.sendNotification({ userId, notification });
  }

  async sendToDevice(token: string, notification: PushNotification): Promise<boolean> {
    return this.sendNotification({ token, notification });
  }

  async subscribeToTopic(tokens: string[], topic: string): Promise<boolean> {
    if (!this.isInitialized || !this.app) {
      logger.error('Firebase not initialized');
      return false;
    }

    try {
      const response = await this.app.messaging().subscribeToTopic(tokens, topic);
      logger.info(`Subscribed ${tokens.length} devices to topic ${topic}`);
      return response.successCount > 0;
    } catch (error) {
      logger.error('Failed to subscribe to topic:', error);
      return false;
    }
  }

  async unsubscribeFromTopic(tokens: string[], topic: string): Promise<boolean> {
    if (!this.isInitialized || !this.app) {
      logger.error('Firebase not initialized');
      return false;
    }

    try {
      const response = await this.app.messaging().unsubscribeFromTopic(tokens, topic);
      logger.info(`Unsubscribed ${tokens.length} devices from topic ${topic}`);
      return response.successCount > 0;
    } catch (error) {
      logger.error('Failed to unsubscribe from topic:', error);
      return false;
    }
  }

  private async getUserTokens(userId: string): Promise<string[]> {
    // This is a placeholder implementation
    // In a real application, you would store and retrieve user FCM tokens from your database
    const db = require('../../db/connection').getDatabase();
    const tokens = await db('user_fcm_tokens')
      .where({ userId })
      .select('token')
      .pluck('token');
    
    return tokens;
  }

  async validateToken(token: string): Promise<boolean> {
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
    } catch (error) {
      logger.warn(`Invalid FCM token: ${token}`);
      return false;
    }
  }

  async getTopicSubscribers(topic: string): Promise<number> {
    // This is a placeholder implementation
    // Firebase doesn't provide a direct API to get topic subscribers count
    // You would need to maintain this information in your database
    return 0;
  }
}

export const pushService = new PushService();
export default pushService; 