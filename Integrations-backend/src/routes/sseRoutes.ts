import { Router } from 'express';
import { authenticateSSE, sendSSEEvent, sendSSEHeartbeat, closeSSEConnection, openAuthenticatedSSEStream } from '../middleware/sseAuthMiddleware';
import { AuthenticatedSSERequest } from '../middleware/sseAuthMiddleware';
import sseHub from '../utils/sseHub';
import logger from '../utils/logger';

const router = Router();

// Apply SSE authentication middleware to all SSE routes
router.use(authenticateSSE);

function resolveSseTenantSlug(req: AuthenticatedSSERequest, res: any): string | null {
  const resolvedSlug = String((req as any).tenant?.tenantSlug || '').trim();
  const requestedSlug = String(((req as any).query.tenantSlug as string) || '').trim();

  if (!resolvedSlug) {
    logger.warn('SSE request rejected without workspace context', {
      user_id: req.user?.id,
      requestedSlug,
      url: (req as any).url
    });
    if (!res.headersSent) {
      res.status(400).json({ error: 'Workspace context required for realtime events' });
    } else {
      closeSSEConnection(res);
    }
    return null;
  }

  if (requestedSlug && requestedSlug !== resolvedSlug) {
    logger.warn('SSE request rejected for workspace mismatch', {
      user_id: req.user?.id,
      requestedSlug,
      resolvedSlug,
      url: (req as any).url
    });
    if (!res.headersSent) {
      res.status(403).json({ error: 'Realtime workspace mismatch' });
    } else {
      closeSSEConnection(res);
    }
    return null;
  }

  return resolvedSlug;
}

// Unified stream that sends an initial event and registers the connection.
// Other parts of the system can still target specific event names via sseHub.sendEvent(userId, event, data)
router.get('/stream', (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    closeSSEConnection(res);
    return;
  }
  const tenantSlug = resolveSseTenantSlug(req, res);
  if (!tenantSlug) return;

  openAuthenticatedSSEStream(req, res);

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
  const tenantSlug = resolveSseTenantSlug(req, res);
  if (!tenantSlug) return;

  openAuthenticatedSSEStream(req, res);

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

router.get('/recent', async (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({
      error: 'Authentication is required for SSE history',
      code: 'AUTH_REQUIRED'
    });
  }

  const tenantSlug = resolveSseTenantSlug(req, res);
  if (!tenantSlug) return;
  const limit = Math.max(1, Math.min(Number((req as any).query.limit || 50), 100));

  return res.json({
    success: true,
    events: await sseHub.getRecentEvents(userId, tenantSlug, limit)
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
  const tenantSlug = resolveSseTenantSlug(req, res);
  if (!tenantSlug) return;

  openAuthenticatedSSEStream(req, res);

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
  const tenantSlug = resolveSseTenantSlug(req, res);
  if (!tenantSlug) return;

  openAuthenticatedSSEStream(req, res);

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
  const tenantSlug = resolveSseTenantSlug(req, res);
  if (!tenantSlug) return;

  openAuthenticatedSSEStream(req, res);

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

  const tenantSlug = resolveSseTenantSlug(req, res);
  if (!tenantSlug) return;
  const hasConnection = sseHub.hasConnection(userId, tenantSlug);
  const connectionCount = sseHub.getConnectionCount(userId, tenantSlug);

  logger.info('🔍 [SSE ROUTES] Connection status check', {
    user_id: userId,
    hasConnection,
    connectionCount,
    tenantSlug
  });

  res.json({
    success: true,
    hasConnection,
    connectionCount,
    tenantSlug,
    message: hasConnection
      ? `This workspace has ${connectionCount} active SSE connection(s) for your session.`
      : 'This workspace has no active SSE connections for your session. Make sure to connect to /api/sse/status first.'
  });
});

router.get('/notifications', (req: AuthenticatedSSERequest, res) => {
  const userId = req.user?.id;

  if (!userId) {
    logger.error('No user ID in SSE notifications request');
    closeSSEConnection(res);
    return;
  }
  const tenantSlug = resolveSseTenantSlug(req, res);
  if (!tenantSlug) return;

  openAuthenticatedSSEStream(req, res);

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



