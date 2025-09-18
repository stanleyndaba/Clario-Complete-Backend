import { getLogger } from '../utils/logger';
import notificationService from './services/notification.service';
import { notificationQueue } from './utils/queue';
import notificationRoutes from './routes/notification.routes';

const logger = getLogger('NotificationsService');

class NotificationsService {
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.info('Notifications service already initialized');
      return;
    }

    try {
      // Initialize queue connection
      await notificationQueue.connect();
      
      // Start consuming notifications
      await notificationQueue.consume(async (message) => {
        await notificationService.processQueuedNotification(message);
      });

      this.isInitialized = true;
      logger.info('Notifications service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize notifications service:', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    try {
      await notificationQueue.close();
      this.isInitialized = false;
      logger.info('Notifications service shut down successfully');
    } catch (error) {
      logger.error('Failed to shut down notifications service:', error);
    }
  }

  // Expose the service for external use
  getService() {
    return notificationService;
  }

  // Expose routes for Express app
  getRoutes() {
    return notificationRoutes;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      return await notificationQueue.healthCheck();
    } catch (error) {
      logger.error('Notifications service health check failed:', error);
      return false;
    }
  }
}

// Singleton instance
export const notificationsService = new NotificationsService();

// Export individual components for direct use
export { notificationService } from './services/notification.service';
export { emailService } from './services/email.service';
export { pushService } from './services/push.service';
export { inAppService } from './services/inapp.service';
export { notificationQueue } from './utils/queue';
export { Notification, UserNotificationPreference } from './models/notification.model';

export default notificationsService; 