// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { Router } from 'express';
import { 
  startSync, 
  getSyncStatus, 
  getDiscrepancies, 
  reconcileInventory 
} from '../controllers/syncController';
import { ConnectorManager } from '../connectors/connectorManager';
import { AmazonConnector } from '../connectors/amazonConnector';
import { AmazonSPAPIService } from '../services/amazonSPAPIService';
import { syncService } from '../services/syncService';

const router = Router();

// Sync operations
router.post('/start', startSync);
router.get('/status/:userId', getSyncStatus);
router.get('/discrepancies/:userId', getDiscrepancies);
router.post('/reconcile/:userId', reconcileInventory);

// Consolidated connector routes
const connectorManager = new ConnectorManager((syncService as any)['reconciliationService']?.['claimDetectorService'] || null);

// Fallback env accessor to avoid TS node types dependency
const ENV: any = (globalThis as any).process ? (globalThis as any).process.env : {};

if (ENV.ENABLE_AMAZON !== 'false') {
  const amazonSvc = new AmazonSPAPIService({
    clientId: ENV.AMAZON_CLIENT_ID || '',
    clientSecret: ENV.AMAZON_CLIENT_SECRET || '',
    refreshToken: ENV.AMAZON_REFRESH_TOKEN || '',
    marketplaceId: ENV.AMAZON_MARKETPLACE_ID || '',
    sellerId: ENV.AMAZON_SELLER_ID || '',
    region: ENV.AMAZON_REGION || 'us-east-1',
  });
  connectorManager.register(new AmazonConnector(amazonSvc));
}

router.post('/connectors/run', async (req: any, res: any) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
    const result = await connectorManager.runAll(userId);
    res.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to run connectors' });
  }
});

router.get('/connectors/health', async (_req: any, res: any) => {
  try {
    const health = await connectorManager.health();
    res.json({ success: true, data: health, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get connectors health' });
  }
});

export default router; 