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

router.get('/history', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const limit = Number((req as any).query?.limit || 18);
    const audits = await auditRunService.getAuditHistory(userId, limit);
    return res.json({ success: true, audits });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to load audit history' });
  }
});

router.get('/schedule', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const result = await auditRunService.getSchedule(userId);
    return res.json({ success: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to load audit schedule' });
  }
});

router.put('/schedule', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const result = await auditRunService.saveSchedule(userId, {
      cadence: req.body?.cadence,
      preferredDayOfWeek: req.body?.preferred_day_of_week,
      preferredDayOfMonth: req.body?.preferred_day_of_month,
      preferredTime: req.body?.preferred_time,
      timezone: req.body?.timezone,
      isPaused: req.body?.is_paused,
    });
    return res.json({ success: true, ...result });
  } catch (error: any) {
    const message = error?.message || 'Failed to save audit schedule';
    const status = /subscription required/i.test(message) ? 402 : /invalid|unsupported|required/i.test(message) ? 400 : 500;
    return res.status(status).json({ success: false, message });
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

router.get('/:id/export-summary', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const auditId = String((req as any).params?.id || '');
    const summary = await auditRunService.getExportSummary(auditId, userId);
    return res.json({ success: true, ...summary });
  } catch (error: any) {
    const status = error?.message === 'Audit run not found' ? 404 : 500;
    return res.status(status).json({ success: false, message: error?.message || 'Failed to prepare audit export' });
  }
});

router.get('/:id/activity', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const auditId = String((req as any).params?.id || '');
    const events = await auditRunService.getActivity(auditId, userId);
    return res.json({ success: true, events });
  } catch (error: any) {
    const status = error?.message === 'Audit run not found' ? 404 : 500;
    return res.status(status).json({ success: false, message: error?.message || 'Failed to load audit activity' });
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
