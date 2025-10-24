"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notification_controller_1 = __importDefault(require("../controllers/notification.controller"));
const authMiddleware_1 = require("../../middleware/authMiddleware");
const router = (0, express_1.Router)();
// Apply authentication middleware to all routes
router.use(authMiddleware_1.authenticateToken);
/**
 * @route POST /api/notifications/send
 * @desc Send a notification manually
 * @access Private
 */
router.post('/send', notification_controller_1.default.sendNotification.bind(notification_controller_1.default));
/**
 * @route GET /api/notifications
 * @desc Get notifications for the authenticated user
 * @access Private
 * @query limit - Number of notifications to return (default: 50)
 * @query offset - Number of notifications to skip (default: 0)
 */
router.get('/', notification_controller_1.default.getNotifications.bind(notification_controller_1.default));
/**
 * @route GET /api/notifications/stats
 * @desc Get notification statistics for the authenticated user
 * @access Private
 */
router.get('/stats', notification_controller_1.default.getNotificationStats.bind(notification_controller_1.default));
/**
 * @route GET /api/notifications/preferences
 * @desc Get user notification preferences
 * @access Private
 */
router.get('/preferences', notification_controller_1.default.getPreferences.bind(notification_controller_1.default));
/**
 * @route PUT /api/notifications/preferences
 * @desc Update user notification preferences
 * @access Private
 */
router.put('/preferences', notification_controller_1.default.updatePreferences.bind(notification_controller_1.default));
/**
 * @route PUT /api/notifications/:notificationId/read
 * @desc Mark a notification as read
 * @access Private
 */
router.put('/:notificationId/read', notification_controller_1.default.markAsRead.bind(notification_controller_1.default));
/**
 * @route PUT /api/notifications/read-all
 * @desc Mark all notifications as read
 * @access Private
 */
router.put('/read-all', notification_controller_1.default.markAllAsRead.bind(notification_controller_1.default));
/**
 * @route DELETE /api/notifications/:notificationId
 * @desc Delete a notification
 * @access Private
 */
router.delete('/:notificationId', notification_controller_1.default.deleteNotification.bind(notification_controller_1.default));
/**
 * @route GET /api/notifications/templates
 * @desc Get available notification templates
 * @access Private
 */
router.get('/templates', notification_controller_1.default.getTemplates.bind(notification_controller_1.default));
/**
 * @route GET /api/notifications/health
 * @desc Health check for notification service
 * @access Private
 */
router.get('/health', notification_controller_1.default.healthCheck.bind(notification_controller_1.default));
exports.default = router;
//# sourceMappingURL=notification.routes.js.map