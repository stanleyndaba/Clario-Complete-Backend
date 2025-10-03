import { Router } from 'express';

const router = Router();

router.post('/webhook', async (_req, res) => {
  try {
    // Mock webhook handling for now
    res.json({
      success: true,
      message: 'Webhook received (mock)'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

export default router;
