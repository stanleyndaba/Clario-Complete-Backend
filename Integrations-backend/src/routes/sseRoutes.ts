import { Router } from 'express';
import { authenticateSSE, sendSSEEvent, sendSSEHeartbeat, closeSSEConnection } from '../middleware/sseAuthMiddleware';
import { AuthenticatedSSERequest } from '../middleware/sseAuthMiddleware';
import sseHub from '../utils/sseHub';
import logger from '../utils/logger';

const router = Router();

// Apply SSE authentication middleware to all SSE routes
router.use(authenticateSSE);

// Unified stream that sends an initial event and registers the connection.
// Other parts of the system can still target specific event names via sseHub.sendEvent(userId, event, data)
router.get('/stream', (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    closeSSEConnection(res);
    return;
  }
  const tenantSlug = (req.query.tenantSlug as string) || 'beta';

  // Initial hello event for immediate readiness
  sendSSEEvent(res, 'connected', {
    status: 'ok',
    timestamp: new Date().toISOString(),
    tenantSlug
  });

  sseHub.addConnection(userId, res, tenantSlug);

  const heartbeatInterval = setInterval(() => {
    sendSSEHeartbeat(res);
  }, 30000);

  (req as any).on('close', () => {
    clearInterval(heartbeatInterval);
    sseHub.removeConnection(userId, res, tenantSlug);
  });

  (req as any).on('error', () => {
    clearInterval(heartbeatInterval);
    sseHub.removeConnection(userId, res, tenantSlug);
  });
});

/**
 * @route GET /api/sse/status
 * @desc General status stream for all events (sync, detection, evidence, claims, refunds)
 * @access Private (JWT required)
 * @note This is the main endpoint used by the frontend for real-time status updates
 */
router.get('/status', (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    logger.warn('SSE status endpoint: No user ID, closing connection');
    closeSSEConnection(res);
    return;
  }
  const tenantSlug = (req.query.tenantSlug as string) || 'beta';

  logger.info('✅ [SSE ROUTES] SSE status connection established', {
    user_id: userId,
    tenantSlug,
    url: (req as any).url,
    connectedUsers: sseHub.getConnectedUsers(),
    totalConnections: sseHub.getConnectionCount(userId)
  });

  // Send initial connection event
  sendSSEEvent(res, 'connected', {
    status: 'ok',
    timestamp: new Date().toISOString(),
    user_id: userId,
    tenantSlug,
    message: 'SSE connection established successfully'
  });

  // Register connection in hub so events can be sent to this user
  sseHub.addConnection(userId, res, tenantSlug);

  logger.info('✅ [SSE ROUTES] Connection registered in SSE hub', {
    user_id: userId,
    connectionCount: sseHub.getConnectionCount(userId),
    allConnectedUsers: sseHub.getConnectedUsers()
  });

  // Set up heartbeat interval to keep connection alive
  const heartbeatInterval = setInterval(() => {
    sendSSEHeartbeat(res);
  }, 30000); // Every 30 seconds

  // Handle client disconnect
  (req as any).on('close', () => {
    logger.info('SSE status connection closed', {
      user_id: userId
    });
    clearInterval(heartbeatInterval);
    sseHub.removeConnection(userId, res, tenantSlug);
  });

  // Handle errors
  (req as any).on('error', (error: any) => {
    logger.error('SSE status connection error', {
      error: error?.message || error,
      user_id: userId
    });
    clearInterval(heartbeatInterval);
    sseHub.removeConnection(userId, res, tenantSlug);
  });
});

/**
 * @route GET /api/sse/sync-progress/:syncId
 * @desc Stream real-time sync progress updates
 * @access Private (JWT required)
 */
router.get('/sync-progress/:syncId', (req: AuthenticatedSSERequest, res) => {
  const { syncId } = (req as any).params;
  const userId = req.user?.id;

  if (!userId) {
    logger.error('No user ID in SSE sync progress request', { syncId });
    closeSSEConnection(res);
    return;
  }
  const tenantSlug = (req.query.tenantSlug as string) || 'beta';

  logger.info('SSE sync progress connection established', {
    user_id: userId,
    sync_id: syncId,
    tenantSlug
  });

  // Send initial connection event
  sendSSEEvent(res, 'sync_progress', {
    sync_id: syncId,
    status: 'connected',
    tenantSlug,
    timestamp: new Date().toISOString()
  });

  // Register in hub
  if (userId) sseHub.addConnection(userId, res, tenantSlug);

  // Set up heartbeat interval
  const heartbeatInterval = setInterval(() => {
    sendSSEHeartbeat(res);
  }, 30000); // Every 30 seconds

  // Handle client disconnect
  (req as any).on('close', () => {
    logger.info('SSE sync progress connection closed', {
      user_id: userId,
      sync_id: syncId
    });
    clearInterval(heartbeatInterval);
    if (userId) sseHub.removeConnection(userId, res, tenantSlug);
  });

  // Handle errors
  (req as any).on('error', (error) => {
    logger.error('SSE sync progress connection error', {
      error,
      user_id: userId,
      sync_id: syncId
    });
    clearInterval(heartbeatInterval);
    if (userId) sseHub.removeConnection(userId, res, tenantSlug);
  });
});

/**
 * @route GET /api/sse/detection-updates/:syncId
 * @desc Stream real-time detection updates
 * @access Private (JWT required)
 */
router.get('/detection-updates/:syncId', (req: AuthenticatedSSERequest, res) => {
  const { syncId } = (req as any).params;
  const userId = req.user?.id;

  if (!userId) {
    logger.error('No user ID in SSE detection updates request', { syncId });
    closeSSEConnection(res);
    return;
  }
  const tenantSlug = (req.query.tenantSlug as string) || 'beta';

  logger.info('SSE detection updates connection established', {
    user_id: userId,
    sync_id: syncId,
    tenantSlug
  });

  // Send initial connection event
  sendSSEEvent(res, 'detection_updates', {
    sync_id: syncId,
    status: 'connected',
    tenantSlug,
    timestamp: new Date().toISOString()
  });

  if (userId) sseHub.addConnection(userId, res, tenantSlug);

  // Set up heartbeat interval
  const heartbeatInterval = setInterval(() => {
    sendSSEHeartbeat(res);
  }, 30000); // Every 30 seconds

  // Handle client disconnect
  (req as any).on('close', () => {
    logger.info('SSE detection updates connection closed', {
      user_id: userId,
      sync_id: syncId
    });
    clearInterval(heartbeatInterval);
    if (userId) sseHub.removeConnection(userId, res, tenantSlug);
  });

  // Handle errors
  (req as any).on('error', (error) => {
    logger.error('SSE detection updates connection error', {
      error,
      user_id: userId,
      sync_id: syncId
    });
    clearInterval(heartbeatInterval);
    if (userId) sseHub.removeConnection(userId, res, tenantSlug);
  });
});

router.get('/financial-events', (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    logger.error('No user ID in SSE financial events request');
    closeSSEConnection(res);
    return;
  }
  const tenantSlug = (req.query.tenantSlug as string) || 'beta';

  logger.info('SSE financial events connection established', {
    user_id: userId,
    tenantSlug
  });

  // Send initial connection event
  sendSSEEvent(res, 'financial_events', {
    status: 'connected',
    tenantSlug,
    timestamp: new Date().toISOString()
  });

  if (userId) sseHub.addConnection(userId, res, tenantSlug);

  // Set up heartbeat interval
  const heartbeatInterval = setInterval(() => {
    sendSSEHeartbeat(res);
  }, 30000); // Every 30 seconds

  // Handle client disconnect
  (req as any).on('close', () => {
    logger.info('SSE financial events connection closed', {
      user_id: userId
    });
    clearInterval(heartbeatInterval);
    if (userId) sseHub.removeConnection(userId, res, tenantSlug);
  });

  // Handle errors
  (req as any).on('error', (error) => {
    logger.error('SSE financial events connection error', {
      error,
      user_id: userId
    });
    clearInterval(heartbeatInterval);
    if (userId) sseHub.removeConnection(userId, res, tenantSlug);
  });
});

/**
 * @route GET /api/sse/connection-status
 * @desc Check SSE connection status for debugging
 * @access Private (JWT required)
 */
router.get('/connection-status', (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  const hasConnection = sseHub.hasConnection(userId);
  const connectionCount = sseHub.getConnectionCount(userId);
  const allConnectedUsers = sseHub.getConnectedUsers();

  logger.info('🔍 [SSE ROUTES] Connection status check', {
    user_id: userId,
    hasConnection,
    connectionCount,
    allConnectedUsers
  });

  res.json({
    success: true,
    user_id: userId,
    hasConnection,
    connectionCount,
    allConnectedUsers,
    message: hasConnection
      ? `User ${userId} has ${connectionCount} active SSE connection(s)`
      : `User ${userId} has no active SSE connections. Make sure to connect to /api/sse/status first.`
  });
});

router.get('/notifications', (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    logger.error('No user ID in SSE notifications request');
    closeSSEConnection(res);
    return;
  }
  const tenantSlug = (req.query.tenantSlug as string) || 'beta';

  logger.info('SSE notifications connection established', {
    user_id: userId,
    tenantSlug
  });

  // Send initial connection event
  sendSSEEvent(res, 'notifications', {
    status: 'connected',
    tenantSlug,
    timestamp: new Date().toISOString()
  });

  if (userId) sseHub.addConnection(userId, res, tenantSlug);

  // Set up heartbeat interval
  const heartbeatInterval = setInterval(() => {
    sendSSEHeartbeat(res);
  }, 30000); // Every 30 seconds

  // Handle client disconnect
  (req as any).on('close', () => {
    logger.info('SSE notifications connection closed', {
      user_id: userId
    });
    clearInterval(heartbeatInterval);
    if (userId) sseHub.removeConnection(userId, res, tenantSlug);
  });

  // Handle errors
  (req as any).on('error', (error) => {
    logger.error('SSE notifications connection error', {
      error,
      user_id: userId
    });
    clearInterval(heartbeatInterval);
    if (userId) sseHub.removeConnection(userId, res, tenantSlug);
  });
});

export default router;



