import { getLogger } from '@/shared/utils/logger';
import { ReportType } from '@/types';

const logger = getLogger('ReportNotifierService');

export interface ReportProcessedNotification {
  reportId: string;
  reportType: ReportType;
  recordCount: number;
  processingTime: number;
}

export interface SyncCompletedNotification {
  totalReports: number;
  processedReports: number;
  failedReports: number;
}

export class ReportNotifierService {
  /**
   * Notify when a report has been processed
   */
  async notifyReportProcessed(userId: string, data: ReportProcessedNotification): Promise<void> {
    try {
      logger.info('Notifying report processed', { userId, data });

      // TODO: Integrate with the shared notifications service
      // For now, just log the notification
      
      const notificationData = {
        type: 'REPORT_PROCESSED',
        userId,
        data: {
          reportId: data.reportId,
          reportType: data.reportType,
          recordCount: data.recordCount,
          processingTime: data.processingTime,
          timestamp: new Date()
        },
        channels: ['inapp', 'email'],
        priority: 2
      };

      // Send to notifications service
      await this.sendToNotificationService(notificationData);

      logger.info('Report processed notification sent', { userId, reportId: data.reportId });

    } catch (error) {
      logger.error('Failed to send report processed notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Notify when a sync operation has completed
   */
  async notifySyncCompleted(userId: string, syncId: string, data: SyncCompletedNotification): Promise<void> {
    try {
      logger.info('Notifying sync completed', { userId, syncId, data });

      const notificationData = {
        type: 'SYNC_COMPLETED',
        userId,
        data: {
          syncId,
          totalReports: data.totalReports,
          processedReports: data.processedReports,
          failedReports: data.failedReports,
          timestamp: new Date()
        },
        channels: ['inapp', 'email'],
        priority: 1
      };

      // Send to notifications service
      await this.sendToNotificationService(notificationData);

      logger.info('Sync completed notification sent', { userId, syncId });

    } catch (error) {
      logger.error('Failed to send sync completed notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Notify when a sync operation has failed
   */
  async notifySyncFailed(userId: string, syncId: string, error: string): Promise<void> {
    try {
      logger.info('Notifying sync failed', { userId, syncId, error });

      const notificationData = {
        type: 'SYNC_FAILED',
        userId,
        data: {
          syncId,
          error,
          timestamp: new Date()
        },
        channels: ['inapp', 'email'],
        priority: 3 // High priority for failures
      };

      // Send to notifications service
      await this.sendToNotificationService(notificationData);

      logger.info('Sync failed notification sent', { userId, syncId });

    } catch (error) {
      logger.error('Failed to send sync failed notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Notify when a report download has failed
   */
  async notifyReportDownloadFailed(userId: string, reportId: string, reportType: ReportType, error: string): Promise<void> {
    try {
      logger.info('Notifying report download failed', { userId, reportId, reportType, error });

      const notificationData = {
        type: 'REPORT_DOWNLOAD_FAILED',
        userId,
        data: {
          reportId,
          reportType,
          error,
          timestamp: new Date()
        },
        channels: ['inapp', 'email'],
        priority: 3
      };

      // Send to notifications service
      await this.sendToNotificationService(notificationData);

      logger.info('Report download failed notification sent', { userId, reportId });

    } catch (error) {
      logger.error('Failed to send report download failed notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Notify when a report parsing has failed
   */
  async notifyReportParsingFailed(userId: string, reportId: string, reportType: ReportType, error: string): Promise<void> {
    try {
      logger.info('Notifying report parsing failed', { userId, reportId, reportType, error });

      const notificationData = {
        type: 'REPORT_PARSING_FAILED',
        userId,
        data: {
          reportId,
          reportType,
          error,
          timestamp: new Date()
        },
        channels: ['inapp', 'email'],
        priority: 3
      };

      // Send to notifications service
      await this.sendToNotificationService(notificationData);

      logger.info('Report parsing failed notification sent', { userId, reportId });

    } catch (error) {
      logger.error('Failed to send report parsing failed notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Notify when a sync has started
   */
  async notifySyncStarted(userId: string, syncId: string, reportTypes: ReportType[]): Promise<void> {
    try {
      logger.info('Notifying sync started', { userId, syncId, reportTypes });

      const notificationData = {
        type: 'SYNC_STARTED',
        userId,
        data: {
          syncId,
          reportTypes,
          timestamp: new Date()
        },
        channels: ['inapp'],
        priority: 2
      };

      // Send to notifications service
      await this.sendToNotificationService(notificationData);

      logger.info('Sync started notification sent', { userId, syncId });

    } catch (error) {
      logger.error('Failed to send sync started notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Notify when a report is being processed
   */
  async notifyReportProcessing(userId: string, reportId: string, reportType: ReportType): Promise<void> {
    try {
      logger.info('Notifying report processing', { userId, reportId, reportType });

      const notificationData = {
        type: 'REPORT_PROCESSING',
        userId,
        data: {
          reportId,
          reportType,
          timestamp: new Date()
        },
        channels: ['inapp'],
        priority: 1
      };

      // Send to notifications service
      await this.sendToNotificationService(notificationData);

      logger.info('Report processing notification sent', { userId, reportId });

    } catch (error) {
      logger.error('Failed to send report processing notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Send notification to the shared notifications service
   */
  private async sendToNotificationService(notificationData: any): Promise<void> {
    try {
      // TODO: Integrate with the shared notifications service
      // This would typically involve:
      // 1. Importing the notifications service
      // 2. Calling the appropriate method to send the notification
      // 3. Handling any errors from the notifications service

      // For now, just log the notification data
      logger.info('Notification data to be sent:', notificationData);

      // Example integration (commented out until notifications service is available):
      /*
      import { notificationsService } from '@/shared/notifications';
      
      await notificationsService.getService().processEvent({
        type: notificationData.type,
        userId: notificationData.userId,
        data: notificationData.data,
        channels: notificationData.channels,
        priority: notificationData.priority
      });
      */

    } catch (error) {
      logger.error('Failed to send notification to service:', error);
      throw error;
    }
  }

  /**
   * Send WebSocket notification for real-time updates
   */
  private async sendWebSocketNotification(userId: string, event: string, data: any): Promise<void> {
    try {
      // TODO: Integrate with WebSocket service for real-time notifications
      // This would typically involve:
      // 1. Importing the WebSocket service
      // 2. Broadcasting the event to the specific user
      // 3. Handling any errors from the WebSocket service

      logger.info('WebSocket notification to be sent:', { userId, event, data });

      // Example integration (commented out until WebSocket service is available):
      /*
      import { websocketService } from '@/shared/websocket';
      
      websocketService.broadcastToUser(userId, event, data);
      */

    } catch (error) {
      logger.error('Failed to send WebSocket notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(userId: string, template: string, data: any): Promise<void> {
    try {
      // TODO: Integrate with email service
      // This would typically involve:
      // 1. Importing the email service
      // 2. Sending the email with the appropriate template
      // 3. Handling any errors from the email service

      logger.info('Email notification to be sent:', { userId, template, data });

      // Example integration (commented out until email service is available):
      /*
      import { emailService } from '@/shared/notifications/services/email.service';
      
      await emailService.sendTemplatedEmail({
        to: userEmail,
        templateId: template,
        data: data
      });
      */

    } catch (error) {
      logger.error('Failed to send email notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }

  /**
   * Send in-app notification
   */
  private async sendInAppNotification(userId: string, title: string, message: string, data?: any): Promise<void> {
    try {
      // TODO: Integrate with in-app notification service
      // This would typically involve:
      // 1. Importing the in-app service
      // 2. Creating and sending the notification
      // 3. Handling any errors from the in-app service

      logger.info('In-app notification to be sent:', { userId, title, message, data });

      // Example integration (commented out until in-app service is available):
      /*
      import { inAppService } from '@/shared/notifications/services/inapp.service';
      
      await inAppService.createNotification({
        userId,
        title,
        message,
        type: 'info',
        priority: 'medium',
        metadata: data
      });
      */

    } catch (error) {
      logger.error('Failed to send in-app notification:', error);
      // Don't throw error to avoid breaking the sync process
    }
  }
} 