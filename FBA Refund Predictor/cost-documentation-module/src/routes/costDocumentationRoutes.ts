import { Router } from 'express';
import { CostDocumentationController } from '../controllers/costDocumentationController';
import { authenticateToken, requireRole, requireUser } from '../middleware/auth';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Cost Documentation Generation Routes

// Automatic trigger - queue job for processing
router.post(
  '/generate/auto',
  requireUser,
  CostDocumentationController.generateFromEvidence
);

// Manual trigger - generate immediately
router.post(
  '/generate/manual',
  requireUser,
  CostDocumentationController.generateManual
);

// Retrieval Routes

// Get cost documentation by anomaly ID
router.get(
  '/anomaly/:anomalyId',
  requireUser,
  CostDocumentationController.getByAnomalyId
);

// Get all cost documentation for a seller
router.get(
  '/seller/:sellerId',
  requireUser,
  CostDocumentationController.getBySellerId
);

// Queue Management Routes (Admin/Agent only)

// Get queue statistics
router.get(
  '/queue/stats',
  requireRole(['admin', 'agent']),
  CostDocumentationController.getQueueStats
);

// Get job status
router.get(
  '/queue/job/:jobId',
  requireRole(['admin', 'agent']),
  CostDocumentationController.getJobStatus
);

// Retry a failed job
router.post(
  '/queue/job/:jobId/retry',
  requireRole(['admin', 'agent']),
  CostDocumentationController.retryJob
);

// Remove a job from the queue
router.delete(
  '/queue/job/:jobId',
  requireRole(['admin', 'agent']),
  CostDocumentationController.removeJob
);

// Pause the queue
router.post(
  '/queue/pause',
  requireRole(['admin', 'agent']),
  CostDocumentationController.pauseQueue
);

// Resume the queue
router.post(
  '/queue/resume',
  requireRole(['admin', 'agent']),
  CostDocumentationController.resumeQueue
);

// Clear the queue
router.delete(
  '/queue/clear',
  requireRole(['admin', 'agent']),
  CostDocumentationController.clearQueue
);

export default router;








