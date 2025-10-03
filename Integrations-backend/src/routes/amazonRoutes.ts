import { Router } from 'express';
import {
  startAmazonOAuth,
  handleAmazonCallback,
  syncAmazonData,
  getAmazonClaims,
  getAmazonInventory,
  disconnectAmazon
} from '../controllers/amazonController';

const router = Router();

router.get('/auth/start', startAmazonOAuth);
router.get('/auth/callback', handleAmazonCallback);
router.post('/sync', syncAmazonData);
router.get('/claims', getAmazonClaims);
router.get('/inventory', getAmazonInventory);
router.post('/disconnect', disconnectAmazon);

// Mock fee endpoint since it was referenced
router.get('/fees', (_, res) => {
  res.json({
    success: true,
    fees: [
      { type: 'referral_fee', amount: 45.50 },
      { type: 'storage_fee', amount: 23.75 }
    ]
  });
});

export default router;
