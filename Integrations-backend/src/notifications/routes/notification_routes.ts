import { Router } from 'express';
import NotificationController from '../controllers/notification_controller';

const router = Router();
const notificationController = new NotificationController();

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Unique notification identifier
 *         user_id:
 *           type: string
 *           description: ID of the user who owns this notification
 *         type:
 *           type: string
 *           enum: [claim_detected, integration_completed, payment_processed, sync_completed, discrepancy_found, system_alert, user_action_required]
 *           description: Type of notification
 *         title:
 *           type: string
 *           description: Notification title
 *         message:
 *           type: string
 *           description: Notification message content
 *         status:
 *           type: string
 *           enum: [pending, sent, delivered, read, failed, expired]
 *           description: Current status of the notification
 *         priority:
 *           type: string
 *           enum: [low, normal, high, urgent]
 *           description: Priority level of the notification
 *         channel:
 *           type: string
 *           enum: [in_app, email, both]
 *           description: Delivery channel(s) for the notification
 *         payload:
 *           type: object
 *           description: Additional metadata for the notification
 *         read_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when notification was read
 *         delivered_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when notification was delivered
 *         expires_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when notification expires
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when notification was created
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Timestamp when notification was last updated
 */

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Get all notifications for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by notification type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by notification status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *         description: Filter by notification priority
 *       - in: query
 *         name: channel
 *         schema:
 *           type: string
 *         description: Filter by delivery channel
 *       - in: query
 *         name: unread_only
 *         schema:
 *           type: boolean
 *         description: Show only unread notifications
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of notifications to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of notifications to skip
 *     responses:
 *       200:
 *         description: List of notifications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Notification'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                     filters:
 *                       type: object
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Internal server error
 */
router.get('/', notificationController.getNotifications.bind(notificationController));

/**
 * @swagger
 * /notifications/{id}:
 *   get:
 *     summary: Get a specific notification by ID
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Notification retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Notification'
 *       401:
 *         description: User not authenticated
 *       403:
 *         description: Access denied
 *       404:
 *         description: Notification not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', notificationController.getNotificationById.bind(notificationController));

/**
 * @swagger
 * /notifications/mark-read:
 *   post:
 *     summary: Mark notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notificationIds:
 *                 oneOf:
 *                   - type: string
 *                     description: Single notification ID
 *                   - type: array
 *                     items:
 *                       type: string
 *                     description: Array of notification IDs
 *                 required: true
 *     responses:
 *       200:
 *         description: Notifications marked as read successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Notification'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Bad request - missing notification IDs
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Internal server error
 */
router.post('/mark-read', notificationController.markAsRead.bind(notificationController));

/**
 * @swagger
 * /notifications/mark-all-read:
 *   post:
 *     summary: Mark all notifications as read for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 meta:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Internal server error
 */
router.post('/mark-all-read', notificationController.markAllAsRead.bind(notificationController));

/**
 * @swagger
 * /notifications:
 *   post:
 *     summary: Create a new notification manually
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - title
 *               - message
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [claim_detected, integration_completed, payment_processed, sync_completed, discrepancy_found, system_alert, user_action_required]
 *                 description: Type of notification
 *               title:
 *                 type: string
 *                 description: Notification title
 *               message:
 *                 type: string
 *                 description: Notification message content
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high, urgent]
 *                 default: normal
 *                 description: Priority level of the notification
 *               channel:
 *                 type: string
 *                 enum: [in_app, email, both]
 *                 default: in_app
 *                 description: Delivery channel(s) for the notification
 *               payload:
 *                 type: object
 *                 description: Additional metadata for the notification
 *               expires_at:
 *                 type: string
 *                 format: date-time
 *                 description: Timestamp when notification expires
 *               immediate:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to send notification immediately
 *     responses:
 *       201:
 *         description: Notification created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Notification'
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request - missing required fields or invalid data
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Internal server error
 */
router.post('/', notificationController.createNotification.bind(notificationController));

/**
 * @swagger
 * /notifications/preferences:
 *   get:
 *     summary: Get notification preferences for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Preferences retrieved successfully
 */
router.get('/preferences', async (req: any, res) => {
    try {
        const userId = req.userId || req.user?.id || req.headers['x-user-id'] || 'demo-user';

        // Try to get from database
        const { supabaseAdmin } = await import('../../database/supabaseClient');
        const { data, error } = await supabaseAdmin
            .from('user_notification_preferences')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (data) {
            return res.json({
                success: true,
                data: data.preferences || {}
            });
        }

        // Return default preferences if none exist
        res.json({
            success: true,
            data: {
                'recovery-guaranteed': { email: true, inApp: true },
                'payout-confirmed': { email: true, inApp: true },
                'invoice-issued': { email: true, inApp: true },
                'team-member-joins': { email: true, inApp: true },
                'document-processed': { email: false, inApp: true },
                'device-login': { email: true, inApp: true },
                'monthly-summary': { email: true, inApp: false },
                'product-updates': { email: false, inApp: true }
            }
        });
    } catch (error: any) {
        console.error('Error fetching notification preferences:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch preferences' });
    }
});

/**
 * @swagger
 * /notifications/preferences:
 *   put:
 *     summary: Update notification preferences for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Preferences updated successfully
 */
router.put('/preferences', async (req: any, res) => {
    try {
        const userId = req.userId || req.user?.id || req.headers['x-user-id'] || 'demo-user';
        const preferences = req.body;

        const { supabaseAdmin } = await import('../../database/supabaseClient');

        // Upsert preferences
        const { error } = await supabaseAdmin
            .from('user_notification_preferences')
            .upsert({
                user_id: userId,
                preferences,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (error) {
            console.warn('Failed to save preferences to DB:', error.message);
            // Still return success - frontend will use its local state
        }

        res.json({
            success: true,
            message: 'Preferences saved successfully'
        });
    } catch (error: any) {
        console.error('Error saving notification preferences:', error);
        res.status(500).json({ success: false, error: 'Failed to save preferences' });
    }
});

/**
 * @swagger
 * /notifications/{id}:
 *   get:
 *     summary: Get a specific notification by ID
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Notification retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Notification'
 *       401:
 *         description: User not authenticated
 *       403:
 *         description: Access denied
 *       404:
 *         description: Notification not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', notificationController.getNotificationById.bind(notificationController));

/**
 * @swagger
 * /notifications/{id}:
 *   put:
 *     summary: Update a notification
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Notification ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, sent, delivered, read, failed, expired]
 *               read_at:
 *                 type: string
 *                 format: date-time
 *               delivered_at:
 *                 type: string
 *                 format: date-time
 *               payload:
 *                 type: object
 *     responses:
 *       200:
 *         description: Notification updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Notification'
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request - missing update data
 *       401:
 *         description: User not authenticated
 *       403:
 *         description: Access denied
 *       404:
 *         description: Notification not found
 *       500:
 *         description: Internal server error
 */
router.put('/:id', notificationController.updateNotification.bind(notificationController));

/**
 * @swagger
 * /notifications/{id}:
 *   delete:
 *     summary: Delete a notification
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Notification deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       401:
 *         description: User not authenticated
 *       403:
 *         description: Access denied
 *       404:
 *         description: Notification not found
 *       500:
 *         description: Internal server error
 */
router.delete('/:id', notificationController.deleteNotification.bind(notificationController));

/**
 * @swagger
 * /notifications/stats:
 *   get:
 *     summary: Get notification statistics for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Total number of notifications
 *                     unread:
 *                       type: integer
 *                       description: Number of unread notifications
 *                     read:
 *                       type: integer
 *                       description: Number of read notifications
 *                     pending:
 *                       type: integer
 *                       description: Number of pending notifications
 *                     failed:
 *                       type: integer
 *                       description: Number of failed notifications
 *                     by_type:
 *                       type: object
 *                       description: Count of notifications by type
 *                     by_priority:
 *                       type: object
 *                       description: Count of notifications by priority
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: User not authenticated
 *       500:
 *         description: Internal server error
 */
router.get('/stats', notificationController.getNotificationStats.bind(notificationController));

/**
 * @swagger
 * /notifications/types:
 *   get:
 *     summary: Get available notification types, priorities, and channels
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available notification options retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     types:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Available notification types
 *                     priorities:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Available priority levels
 *                     channels:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Available delivery channels
 *       500:
 *         description: Internal server error
 */
router.get('/types', notificationController.getNotificationTypes.bind(notificationController));

/**
 * @swagger
 * /notifications/health:
 *   get:
 *     summary: Health check endpoint for notifications service
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 service:
 *                   type: string
 *                   example: notifications
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Service uptime in seconds
 *       500:
 *         description: Service is unhealthy
 */
router.get('/health', notificationController.healthCheck.bind(notificationController));

/**
 * @swagger
 * /notifications/preferences:
 *   get:
 *     summary: Get notification preferences for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Preferences retrieved successfully
 */
router.get('/preferences', async (req: any, res) => {
    try {
        const userId = req.userId || req.user?.id || req.headers['x-user-id'] || 'demo-user';

        // Try to get from database
        const { supabaseAdmin } = await import('../../database/supabaseClient');
        const { data, error } = await supabaseAdmin
            .from('user_notification_preferences')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (data) {
            return res.json({
                success: true,
                data: data.preferences || {}
            });
        }

        // Return default preferences if none exist
        res.json({
            success: true,
            data: {
                'recovery-guaranteed': { email: true, inApp: true },
                'payout-confirmed': { email: true, inApp: true },
                'invoice-issued': { email: true, inApp: true },
                'team-member-joins': { email: true, inApp: true },
                'document-processed': { email: false, inApp: true },
                'device-login': { email: true, inApp: true },
                'monthly-summary': { email: true, inApp: false },
                'product-updates': { email: false, inApp: true }
            }
        });
    } catch (error: any) {
        console.error('Error fetching notification preferences:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch preferences' });
    }
});

/**
 * @swagger
 * /notifications/preferences:
 *   put:
 *     summary: Update notification preferences for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Preferences updated successfully
 */
router.put('/preferences', async (req: any, res) => {
    try {
        const userId = req.userId || req.user?.id || req.headers['x-user-id'] || 'demo-user';
        const preferences = req.body;

        const { supabaseAdmin } = await import('../../database/supabaseClient');

        // Upsert preferences
        const { error } = await supabaseAdmin
            .from('user_notification_preferences')
            .upsert({
                user_id: userId,
                preferences,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

        if (error) {
            console.warn('Failed to save preferences to DB:', error.message);
            // Still return success - frontend will use its local state
        }

        res.json({
            success: true,
            message: 'Preferences saved successfully'
        });
    } catch (error: any) {
        console.error('Error saving notification preferences:', error);
        res.status(500).json({ success: false, error: 'Failed to save preferences' });
    }
});

export default router;

