import notificationService from '../services/notification.service';
import { Notification, UserNotificationPreference } from '../models/notification.model';

// Mock dependencies
jest.mock('../models/notification.model');
jest.mock('../utils/queue');
jest.mock('./email.service');
jest.mock('./push.service');
jest.mock('./inapp.service');

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processEvent', () => {
    it('should process a notification event successfully', async () => {
      const mockEvent = {
        type: 'fba_report_ready',
        userId: 'user-1',
        data: { reportId: 'report-1', reportType: 'inventory' },
      };

      // Mock user preferences
      (UserNotificationPreference.findByUserIdAndType as jest.Mock).mockResolvedValue([
        { channel: 'inapp', enabled: true },
        { channel: 'email', enabled: true },
      ]);

      // Mock notification creation
      (Notification.create as jest.Mock).mockResolvedValue({
        id: 'notification-1',
        userId: 'user-1',
        type: 'fba_report_ready',
        channel: 'inapp',
        status: 'pending',
      });

      await notificationService.processEvent(mockEvent);

      expect(Notification.create).toHaveBeenCalledTimes(2); // One for each channel
    });

    it('should skip processing if no enabled channels', async () => {
      const mockEvent = {
        type: 'fba_report_ready',
        userId: 'user-1',
        data: { reportId: 'report-1', reportType: 'inventory' },
      };

      // Mock user preferences with all disabled
      (UserNotificationPreference.findByUserIdAndType as jest.Mock).mockResolvedValue([
        { channel: 'inapp', enabled: false },
        { channel: 'email', enabled: false },
      ]);

      await notificationService.processEvent(mockEvent);

      expect(Notification.create).not.toHaveBeenCalled();
    });
  });

  describe('processQueuedNotification', () => {
    it('should process email notification successfully', async () => {
      const mockMessage = {
        id: 'notification-1',
        type: 'low_stock_alert',
        userId: 'user-1',
        channel: 'email',
        templateId: 'low_stock_alert',
        payload: { productName: 'Test Product', sku: 'TEST-123' },
      };

      const mockNotification = {
        id: 'notification-1',
        userId: 'user-1',
        markAsSent: jest.fn(),
        markAsFailed: jest.fn(),
      };

      (Notification.findById as jest.Mock).mockResolvedValue(mockNotification);

      // Mock email service
      const emailService = require('./email.service').default;
      emailService.sendTemplatedEmail.mockResolvedValue(true);

      await notificationService.processQueuedNotification(mockMessage);

      expect(mockNotification.markAsSent).toHaveBeenCalled();
    });

    it('should handle notification processing failure', async () => {
      const mockMessage = {
        id: 'notification-1',
        type: 'low_stock_alert',
        userId: 'user-1',
        channel: 'email',
        templateId: 'low_stock_alert',
        payload: { productName: 'Test Product', sku: 'TEST-123' },
      };

      const mockNotification = {
        id: 'notification-1',
        userId: 'user-1',
        markAsSent: jest.fn(),
        markAsFailed: jest.fn(),
      };

      (Notification.findById as jest.Mock).mockResolvedValue(mockNotification);

      // Mock email service to fail
      const emailService = require('./email.service').default;
      emailService.sendTemplatedEmail.mockResolvedValue(false);

      await notificationService.processQueuedNotification(mockMessage);

      expect(mockNotification.markAsFailed).toHaveBeenCalledWith('Failed to send notification');
    });
  });

  describe('getNotificationStats', () => {
    it('should return notification statistics', async () => {
      const userId = 'user-1';
      const mockStats = {
        total: 10,
        sent: 8,
        failed: 1,
        pending: 1,
        byChannel: { email: 5, inapp: 5 },
      };

      // Mock database queries
      const db = require('../../db/connection').getDatabase;
      db.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        count: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue({ count: '10' }),
        select: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockResolvedValue([
          { channel: 'email', count: '5' },
          { channel: 'inapp', count: '5' },
        ]),
      });

      const stats = await notificationService.getNotificationStats(userId);

      expect(stats).toEqual(mockStats);
    });
  });

  describe('event listeners', () => {
    it('should handle FBA report ready event', async () => {
      const processEventSpy = jest.spyOn(notificationService, 'processEvent');

      await notificationService.onFbaReportReady('user-1', 'report-1', 'inventory');

      expect(processEventSpy).toHaveBeenCalledWith({
        type: 'fba_report_ready',
        userId: 'user-1',
        data: {
          reportId: 'report-1',
          reportType: 'inventory',
          generatedAt: expect.any(String),
        },
      });
    });

    it('should handle low stock alert event', async () => {
      const processEventSpy = jest.spyOn(notificationService, 'processEvent');

      await notificationService.onLowStockAlert('user-1', 'Test Product', 'TEST-123', 5);

      expect(processEventSpy).toHaveBeenCalledWith({
        type: 'low_stock_alert',
        userId: 'user-1',
        data: {
          productName: 'Test Product',
          sku: 'TEST-123',
          currentStock: 5,
          lastUpdated: expect.any(String),
        },
      });
    });
  });
}); 