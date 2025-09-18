import { Router } from 'express';
import notificationController from '../controllers/notification.controller';
import { authenticateToken } from '../../middleware/authMiddleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * @route POST /api/notifications/send
 * @desc Send a notification manually
 * @access Private
 */
router.post('/send', notificationController.sendNotification.bind(notificationController));

/**
 * @route GET /api/notifications
 * @desc Get notifications for the authenticated user
 * @access Private
 * @query limit - Number of notifications to return (default: 50)
 * @query offset - Number of notifications to skip (default: 0)
 */
router.get('/', notificationController.getNotifications.bind(notificationController));

/**
 * @route GET /api/notifications/stats
 * @desc Get notification statistics for the authenticated user
 * @access Private
 */
router.get('/stats', notificationController.getNotificationStats.bind(notificationController));

/**
 * @route GET /api/notifications/preferences
 * @desc Get user notification preferences
 * @access Private
 */
router.get('/preferences', notificationController.getPreferences.bind(notificationController));

/**
 * @route PUT /api/notifications/preferences
 * @desc Update user notification preferences
 * @access Private
 */
router.put('/preferences', notificationController.updatePreferences.bind(notificationController));

/**
 * @route PUT /api/notifications/:notificationId/read
 * @desc Mark a notification as read
 * @access Private
 */
router.put('/:notificationId/read', notificationController.markAsRead.bind(notificationController));

/**
 * @route PUT /api/notifications/read-all
 * @desc Mark all notifications as read
 * @access Private
 */
router.put('/read-all', notificationController.markAllAsRead.bind(notificationController));

/**
 * @route DELETE /api/notifications/:notificationId
 * @desc Delete a notification
 * @access Private
 */
router.delete('/:notificationId', notificationController.deleteNotification.bind(notificationController));

/**
 * @route GET /api/notifications/templates
 * @desc Get available notification templates
 * @access Private
 */
router.get('/templates', notificationController.getTemplates.bind(notificationController));

/**
 * @route GET /api/notifications/health
 * @desc Health check for notification service
 * @access Private
 */
router.get('/health', notificationController.healthCheck.bind(notificationController));

export default router; 