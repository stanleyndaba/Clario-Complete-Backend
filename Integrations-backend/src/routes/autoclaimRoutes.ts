import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

router.get('/rules', async (_req, res) => {
  try {
    res.json({
      success: true,
      rules: []
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.post('/rules', async (_req, res) => {
  try {
    res.json({
      success: true,
      ruleId: 'rule-' + Date.now(),
      message: 'Auto-claim rule created'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/history', async (_req, res) => {
  try {
    res.json({
      success: true,
      history: []
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    res.json({
      success: true,
      settings: {
        enabled: false,
        minAmount: 0,
        maxAmount: 0
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

export default router;
