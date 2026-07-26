import { Router } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import auditRunService from '../services/auditRunService';

const router = Router();

router.use(authenticateToken);

router.post('/start', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const result = await auditRunService.startAudit(userId, req.user?.email || null);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to start audit' });
  }
});

router.get('/latest', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const audit = await auditRunService.getLatestAudit(userId);
    return res.json({ success: true, audit });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to load latest audit' });
  }
});

router.post('/:id/connect-amazon', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const auditId = String((req as any).params?.id || '');
    const audit = await auditRunService.getAudit(auditId, userId);
    return res.json({
      success: true,
      audit,
      message: 'Use the existing Amazon OAuth start endpoint with this tenant.',
      next: {
        method: 'GET',
        path: `/api/v1/integrations/amazon/auth/start?tenantSlug=${encodeURIComponent(String((req as any).query?.tenantSlug || ''))}`
      }
    });
  } catch (error: any) {
    const status = error?.message === 'Audit run not found' ? 404 : 500;
    return res.status(status).json({ success: false, message: error?.message || 'Failed to prepare Amazon connection' });
  }
});

router.post('/:id/run', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const auditId = String((req as any).params?.id || '');
    const audit = await auditRunService.runAudit(auditId, userId);
    return res.json({ success: true, audit });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to run audit' });
  }
});

router.get('/:id/results', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const auditId = String((req as any).params?.id || '');
    const result = await auditRunService.getResults(auditId, userId);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    const status = error?.message === 'Audit run not found' ? 404 : 500;
    return res.status(status).json({ success: false, message: error?.message || 'Failed to load audit results' });
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const auditId = String((req as any).params?.id || '');
    const audit = await auditRunService.getAudit(auditId, userId);
    return res.json({ success: true, audit });
  } catch (error: any) {
    const status = error?.message === 'Audit run not found' ? 404 : 500;
    return res.status(status).json({ success: false, message: error?.message || 'Failed to load audit' });
  }
});

export default router;
