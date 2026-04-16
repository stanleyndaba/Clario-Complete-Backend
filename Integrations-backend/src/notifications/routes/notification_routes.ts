import { Router } from 'express';
import NotificationController from '../controllers/notification_controller';
import { normalizeNotificationPreferences } from '../preferencesConfig';

const router = Router();
const notificationController = new NotificationController();

function getPreferenceUserId(req: any): string {
    const userId = req.userId || req.user?.id || req.headers['x-user-id'];
    if (!userId) {
        throw new Error('USER_REQUIRED');
    }
    return String(userId);
}

function getPreferenceTenantId(req: any): string {
    const tenantId = req.tenant?.tenantId || req.tenantId || req.user?.tenant_id || req.headers['x-tenant-id'];
    if (!tenantId) {
        throw new Error('TENANT_REQUIRED');
    }
    return String(tenantId);
}

async function getStoredUserPreferences(userId: string, tenantId: string): Promise<Record<string, any>> {
    const { supabaseAdmin } = await import('../../database/supabaseClient');
    const { data, error } = await supabaseAdmin
        .from('user_notification_preferences')
        .select('preferences')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    const rawPreferences = (data?.preferences || {}) as Record<string, any>;
    const normalized = normalizeNotificationPreferences(rawPreferences) as Record<string, any>;
    const autoFileEnabled = rawPreferences?.auto_file_cases?.enabled;

    if (typeof autoFileEnabled === 'boolean') {
        normalized.auto_file_cases = { enabled: autoFileEnabled };
    }

    return normalized;
}

function getAutoFilePreferenceValue(preferences: Record<string, any>): boolean {
    const storedValue = preferences?.auto_file_cases?.enabled;
    return typeof storedValue === 'boolean' ? storedValue : true;
}

function normalizeFilingValue(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function normalizeReasonList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeFilingValue(item)).filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => normalizeFilingValue(item))
            .filter(Boolean);
    }

    return [];
}

async function buildAutoFileGateStatus(userId: string, tenantId: string, sellerIntentEnabled: boolean) {
    const checkedAt = new Date().toISOString();
    const { supabaseAdmin } = await import('../../database/supabaseClient');

    let globalFilingEnabled: boolean | null = null;
    let queueAvailable: boolean | null = null;
    let queueReason: string | null = null;
    let paymentRequired = false;
    let filingReadyCount = 0;
    let evidenceBlockedCount = 0;

    try {
        const { default: operationalControlService } = await import('../../services/operationalControlService');
        globalFilingEnabled = await operationalControlService.isEnabled('auto_filing', true);
    } catch (error: any) {
        console.warn('[NOTIFICATIONS] Failed to resolve auto-file global gate', {
            userId,
            tenantId,
            error: error?.message || String(error)
        });
    }

    try {
        const { default: refundFilingWorker } = await import('../../workers/refundFilingWorker');
        const queueMetrics = await refundFilingWorker.getSubmissionQueueMetrics();
        queueAvailable = Boolean(queueMetrics.available);
        queueReason = queueMetrics.reason || null;
    } catch (error: any) {
        queueAvailable = null;
        queueReason = error?.message || 'queue_status_unavailable';
        console.warn('[NOTIFICATIONS] Failed to resolve auto-file queue gate', {
            userId,
            tenantId,
            error: error?.message || String(error)
        });
    }

    try {
        const { isAgent7UnpaidFilingOverrideEnabled } = await import('../../services/agent7UnpaidFilingOverride');
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('id, is_paid_beta, amazon_seller_id, seller_id')
            .eq('id', userId)
            .maybeSingle();

        paymentRequired = Boolean(user && !user.is_paid_beta && !isAgent7UnpaidFilingOverrideEnabled());

        const sellerIds = Array.from(new Set([
            userId,
            user?.amazon_seller_id,
            user?.seller_id
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));

        if (sellerIds.length > 0) {
            const { data: cases, error } = await supabaseAdmin
                .from('dispute_cases')
                .select('id, eligibility_status, filing_status, block_reasons')
                .eq('tenant_id', tenantId)
                .in('seller_id', sellerIds)
                .in('filing_status', ['pending', 'retrying', 'blocked', 'pending_safety_verification', 'pending_approval'])
                .limit(500);

            if (error) {
                throw error;
            }

            filingReadyCount = (cases || []).filter((record: any) => {
                const eligibilityStatus = normalizeFilingValue(record?.eligibility_status);
                const filingStatus = normalizeFilingValue(record?.filing_status);
                return eligibilityStatus === 'ready' && ['pending', 'retrying'].includes(filingStatus);
            }).length;

            evidenceBlockedCount = (cases || []).filter((record: any) => {
                const eligibilityStatus = normalizeFilingValue(record?.eligibility_status);
                const reasons = normalizeReasonList(record?.block_reasons);
                return eligibilityStatus === 'insufficient_data' || reasons.includes('missing_evidence_links');
            }).length;
        }
    } catch (error: any) {
        console.warn('[NOTIFICATIONS] Failed to resolve auto-file case/payment gate', {
            userId,
            tenantId,
            error: error?.message || String(error)
        });
    }

    let primaryBlocker: string | null = null;
    let message = sellerIntentEnabled
        ? 'Auto-File is on. Eligible cases can be submitted automatically when all filing requirements are met.'
        : 'Auto-File is off. Cases will wait for your review before filing.';

    if (sellerIntentEnabled) {
        if (globalFilingEnabled === false) {
            primaryBlocker = 'global_filing_paused';
            message = 'Auto-File is on, but global filing is currently paused.';
        } else if (paymentRequired) {
            primaryBlocker = 'payment_required';
            message = 'Auto-File is on, but payment is required before filing.';
        } else if (queueAvailable === false) {
            primaryBlocker = 'filing_queue_paused';
            message = 'Auto-File is on, but filing dispatch is temporarily paused.';
        } else if (evidenceBlockedCount > 0 && filingReadyCount === 0) {
            primaryBlocker = 'evidence_required';
            message = 'Auto-File is on, but some cases still need evidence before filing.';
        } else if (filingReadyCount > 0) {
            message = `${filingReadyCount} filing-ready case${filingReadyCount === 1 ? '' : 's'} can submit automatically when dispatch gates permit it.`;
        }
    }

    return {
        sellerIntentEnabled,
        globalFilingEnabled,
        queueAvailable,
        queueReason,
        paymentRequired,
        filingReadyCount,
        evidenceBlockedCount,
        primaryBlocker,
        message,
        checkedAt
    };
}

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
        const userId = getPreferenceUserId(req);
        const tenantId = getPreferenceTenantId(req);
        const preferences = await getStoredUserPreferences(userId, tenantId);

        res.json({
            success: true,
            data: preferences
        });
    } catch (error: any) {
        console.error('Error fetching notification preferences:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch preferences' });
    }
});

router.get('/preferences/filing', async (req: any, res) => {
    try {
        const userId = getPreferenceUserId(req);
        const tenantId = getPreferenceTenantId(req);
        const preferences = await getStoredUserPreferences(userId, tenantId);
        const enabled = getAutoFilePreferenceValue(preferences);
        const gateStatus = await buildAutoFileGateStatus(userId, tenantId, enabled);

        res.json({
            success: true,
            data: {
                enabled,
                gateStatus
            }
        });
    } catch (error: any) {
        console.error('Error fetching filing preferences:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch filing preferences' });
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
        const userId = getPreferenceUserId(req);
        const tenantId = getPreferenceTenantId(req);
        const existingPreferences = await getStoredUserPreferences(userId, tenantId);
        const preferences = normalizeNotificationPreferences({ ...(req.body || {}) }) as Record<string, any>;
        const existingAutoFileEnabled = existingPreferences?.auto_file_cases?.enabled;

        if (typeof existingAutoFileEnabled === 'boolean') {
            preferences.auto_file_cases = { enabled: existingAutoFileEnabled };
        }

        const { supabaseAdmin } = await import('../../database/supabaseClient');

        const { error } = await supabaseAdmin
            .from('user_notification_preferences')
            .upsert({
                user_id: userId,
                tenant_id: tenantId,
                preferences,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,tenant_id' });

        if (error) {
            return res.status(500).json({ success: false, error: 'Failed to save preferences' });
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

router.put('/preferences/filing', async (req: any, res) => {
    try {
        const userId = getPreferenceUserId(req);
        const tenantId = getPreferenceTenantId(req);
        const enabled = req.body?.enabled;

        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, error: 'enabled must be a boolean' });
        }

        const preferences = await getStoredUserPreferences(userId, tenantId);
        const { supabaseAdmin } = await import('../../database/supabaseClient');

        const { error } = await supabaseAdmin
            .from('user_notification_preferences')
            .upsert({
                user_id: userId,
                tenant_id: tenantId,
                preferences: {
                    ...preferences,
                    auto_file_cases: {
                        enabled
                    }
                },
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,tenant_id' });

        if (error) {
            return res.status(500).json({ success: false, error: 'Failed to save filing preferences' });
        }

        if (enabled) {
            try {
                const { default: agent7ResumeService } = await import('../../services/agent7ResumeService');
                const resumeStats = await agent7ResumeService.reevaluateClearableCasesForUser(userId, 25);
                console.info('[NOTIFICATIONS] Auto-file enabled, triggered Agent 7 resume sweep', {
                    userId,
                    ...resumeStats
                });
            } catch (resumeError: any) {
                console.warn('[NOTIFICATIONS] Failed to trigger Agent 7 resume sweep', {
                    userId,
                    error: resumeError.message
                });
            }
        }

        res.json({
            success: true,
            message: 'Filing preferences saved successfully',
            data: {
                enabled,
                gateStatus: await buildAutoFileGateStatus(userId, tenantId, enabled)
            }
        });
    } catch (error: any) {
        console.error('Error saving filing preferences:', error);
        res.status(500).json({ success: false, error: 'Failed to save filing preferences' });
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
export default router;

