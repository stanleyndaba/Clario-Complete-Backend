import { Router, Request, Response } from 'express';
import onboardingCapacityService from '../services/onboardingCapacityService';

const router = Router();

/**
 * GET /api/onboarding/capacity
 * Returns global onboarding capacity status.
 */
router.get('/capacity', async (_req: Request, res: Response) => {
  const status = await onboardingCapacityService.getCapacityStatus();
  return res.json({
    success: true,
    ...status
  });
});

export default router;

